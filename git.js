#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const cwd = process.cwd();
const VCS_DIR = ".mygit";

// Stop
function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// Path
function repoPath(...parts) {
  return path.join(cwd, VCS_DIR, ...parts);
}

// Check
function ensureRepo() {
  if (!fs.existsSync(repoPath())) {
    die("Not a mygit repository. Run: node git.js init");
  }
}

// Folder
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Read
function readText(file, fallback = "") {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
}

// Write
function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value);
}

// Hash
function hashBytes(bytes) {
  return crypto.createHash("sha1").update(bytes).digest("hex");
}

// Store
function hashObject(type, content, write = true) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const store = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
  const oid = hashBytes(store);

  if (write) {
    const objectFile = repoPath("objects", oid.slice(0, 2), oid.slice(2));
    if (!fs.existsSync(objectFile)) {
      ensureDir(path.dirname(objectFile));
      fs.writeFileSync(objectFile, zlib.deflateSync(store));
    }
  }

  return oid;
}

// Load
function readObject(oid) {
  const objectFile = repoPath("objects", oid.slice(0, 2), oid.slice(2));
  if (!fs.existsSync(objectFile)) die(`Object not found: ${oid}`);
  const store = zlib.inflateSync(fs.readFileSync(objectFile));
  const nul = store.indexOf(0);
  const header = store.subarray(0, nul).toString();
  const [type, sizeText] = header.split(" ");
  const content = store.subarray(nul + 1);
  if (content.length !== Number(sizeText)) die(`Corrupt object: ${oid}`);
  return { type, content };
}

// Ref
function getHeadRef() {
  const head = readText(repoPath("HEAD")).trim();
  return head.startsWith("ref: ") ? head.slice(5) : null;
}

// Head
function getHeadOid() {
  const ref = getHeadRef();
  if (ref) return readText(repoPath(ref)).trim() || null;
  return readText(repoPath("HEAD")).trim() || null;
}

// Update
function setHeadOid(oid) {
  const ref = getHeadRef();
  if (ref) writeText(repoPath(ref), `${oid}\n`);
  else writeText(repoPath("HEAD"), `${oid}\n`);
}

// Branch
function currentBranch() {
  const ref = getHeadRef();
  return ref && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
}

// Index
function loadIndex() {
  ensureRepo();
  const indexFile = repoPath("index");
  return fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
}

// Save
function saveIndex(index) {
  writeText(repoPath("index"), `${JSON.stringify(index, null, 2)}\n`);
}

// Clean
function normalizeFile(file) {
  const relative = path.relative(cwd, path.resolve(cwd, file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) die(`Outside repository: ${file}`);
  if (relative === VCS_DIR || relative.startsWith(`${VCS_DIR}${path.sep}`)) die(`Refusing to add ${VCS_DIR}`);
  if (relative === ".git" || relative.startsWith(`.git${path.sep}`)) die("Refusing to add .git");
  return relative.split(path.sep).join("/");
}

// Files
function listFiles(start = cwd) {
  const result = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    if (entry.name === VCS_DIR || entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(start, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full));
    if (entry.isFile()) result.push(path.relative(cwd, full).split(path.sep).join("/"));
  }
  return result.sort();
}

// Tree
function treeFromIndex(index) {
  return Object.entries(index)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, oid]) => `${oid} ${file}`)
    .join("\n");
}

// Parse
function parseTree(oid) {
  if (!oid) return {};
  const object = readObject(oid);
  if (object.type !== "tree") die(`Expected tree, found ${object.type}`);
  const text = object.content.toString();
  if (!text.trim()) return {};
  return Object.fromEntries(text.split("\n").map((line) => {
    const space = line.indexOf(" ");
    return [line.slice(space + 1), line.slice(0, space)];
  }));
}

// Commit
function parseCommit(oid) {
  const object = readObject(oid);
  if (object.type !== "commit") die(`Expected commit, found ${object.type}`);
  const text = object.content.toString();
  const [headers, ...messageParts] = text.split("\n\n");
  const commit = { oid, parents: [], message: messageParts.join("\n\n").trimEnd() };
  for (const line of headers.split("\n")) {
    const [key, ...rest] = line.split(" ");
    if (key === "tree") commit.tree = rest.join(" ");
    if (key === "parent") commit.parents.push(rest.join(" "));
    if (key === "author") commit.author = rest.join(" ");
    if (key === "date") commit.date = rest.join(" ");
  }
  return commit;
}

// Snapshot
function headTree() {
  const head = getHeadOid();
  return head ? parseTree(parseCommit(head).tree) : {};
}

// Working
function workingOid(file) {
  const full = path.join(cwd, file);
  return fs.existsSync(full) ? hashObject("blob", fs.readFileSync(full), false) : null;
}

// Restore
function restoreTree(tree) {
  for (const file of listFiles()) {
    if (file !== "git.js" && !tree[file]) fs.rmSync(path.join(cwd, file), { force: true });
  }
  for (const [file, oid] of Object.entries(tree)) {
    const object = readObject(oid);
    if (object.type !== "blob") die(`Expected blob for ${file}, found ${object.type}`);
    const full = path.join(cwd, file);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, object.content);
  }
}

// Init
function commandInit() {
  ensureDir(repoPath("objects"));
  ensureDir(repoPath("refs", "heads"));
  writeText(repoPath("HEAD"), "ref: refs/heads/main\n");
  if (!fs.existsSync(repoPath("index"))) saveIndex({});
  console.log(`Initialized empty mygit repository in ${repoPath()}`);
}

// Add
function commandAdd(files) {
  ensureRepo();
  if (files.length === 0) die("Usage: node git.js add <file...>");
  const index = loadIndex();
  for (const input of files) {
    const file = normalizeFile(input);
    if (!fs.existsSync(path.join(cwd, file))) die(`File not found: ${file}`);
    index[file] = hashObject("blob", fs.readFileSync(path.join(cwd, file)));
    console.log(`added ${file}`);
  }
  saveIndex(index);
}

// Commit
function commandCommit(args) {
  ensureRepo();
  const messageIndex = args.indexOf("-m");
  const message = messageIndex >= 0 ? args[messageIndex + 1] : null;
  if (!message) die('Usage: node git.js commit -m "message"');

  const index = loadIndex();
  const treeOid = hashObject("tree", treeFromIndex(index));
  const parent = getHeadOid();
  const name = process.env.GIT_AUTHOR_NAME || process.env.USER || "local";
  const email = process.env.GIT_AUTHOR_EMAIL || `${name}@local`;
  const lines = [
    `tree ${treeOid}`,
    parent ? `parent ${parent}` : null,
    `author ${name} <${email}>`,
    `date ${new Date().toISOString()}`,
    "",
    message,
    "",
  ].filter((line) => line !== null);
  const oid = hashObject("commit", lines.join("\n"));
  setHeadOid(oid);
  console.log(`[${currentBranch() || "detached"} ${oid.slice(0, 7)}] ${message}`);
}

// Log
function commandLog() {
  ensureRepo();
  let oid = getHeadOid();
  if (!oid) {
    console.log("No commits yet.");
    return;
  }
  while (oid) {
    const commit = parseCommit(oid);
    console.log(`commit ${commit.oid}`);
    console.log(`Author: ${commit.author}`);
    console.log(`Date:   ${commit.date}`);
    console.log("");
    console.log(`    ${commit.message}`);
    console.log("");
    oid = commit.parents[0];
  }
}

// Status
function commandStatus() {
  ensureRepo();
  const branch = currentBranch();
  console.log(`On branch ${branch || "detached HEAD"}`);
  const index = loadIndex();
  const committed = headTree();
  const files = new Set([...Object.keys(index), ...Object.keys(committed), ...listFiles()]);
  const staged = [];
  const modified = [];
  const untracked = [];

  for (const file of [...files].sort()) {
    const inIndex = index[file];
    const inCommit = committed[file];
    const inWork = workingOid(file);
    if (inIndex && inIndex !== inCommit) staged.push(file);
    if (inIndex && inWork !== inIndex) modified.push(file);
    if (!inIndex && inWork) untracked.push(file);
  }

  printGroup("Changes to be committed", staged);
  printGroup("Changes not staged for commit", modified);
  printGroup("Untracked files", untracked);
  if (!staged.length && !modified.length && !untracked.length) console.log("nothing to commit, working tree clean");
}

// Print
function printGroup(title, files) {
  if (!files.length) return;
  console.log(`\n${title}:`);
  for (const file of files) console.log(`  ${file}`);
}

// Branch
function commandBranch(args) {
  ensureRepo();
  if (args.length === 0) {
    const current = currentBranch();
    const dir = repoPath("refs", "heads");
    for (const branch of fs.readdirSync(dir).sort()) {
      console.log(`${branch === current ? "*" : " "} ${branch}`);
    }
    return;
  }
  const name = args[0];
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) die(`Invalid branch name: ${name}`);
  const head = getHeadOid();
  if (!head) die("Cannot create a branch before the first commit.");
  writeText(repoPath("refs", "heads", name), `${head}\n`);
  console.log(`Created branch ${name}`);
}

// Switch
function commandCheckout(args) {
  ensureRepo();
  const name = args[0];
  if (!name) die("Usage: node git.js checkout <branch>");
  const refFile = repoPath("refs", "heads", name);
  if (!fs.existsSync(refFile)) die(`Unknown branch: ${name}`);
  const oid = readText(refFile).trim();
  writeText(repoPath("HEAD"), `ref: refs/heads/${name}\n`);
  const tree = oid ? parseTree(parseCommit(oid).tree) : {};
  restoreTree(tree);
  saveIndex(tree);
  console.log(`Switched to branch ${name}`);
}

// Show
function commandCatFile(args) {
  ensureRepo();
  const oid = args[0];
  if (!oid) die("Usage: node git.js cat-file <object-id>");
  const object = readObject(oid);
  process.stdout.write(object.content);
  if (!object.content.toString().endsWith("\n")) process.stdout.write("\n");
}

// Help
function help() {
  console.log(`mygit - simple version control

Usage:
  node git.js init
  node git.js add <file...>
  node git.js commit -m "message"
  node git.js status
  node git.js log
  node git.js branch [name]
  node git.js checkout <branch>
  node git.js cat-file <object-id>
`);
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "init": commandInit(); break;
    case "add": commandAdd(args); break;
    case "commit": commandCommit(args); break;
    case "status": commandStatus(); break;
    case "log": commandLog(); break;
    case "branch": commandBranch(args); break;
    case "checkout": commandCheckout(args); break;
    case "cat-file": commandCatFile(args); break;
    case undefined:
    case "help":
    case "--help":
    case "-h": help(); break;
    default: die(`Unknown command: ${command}\nRun: node git.js help`);
  }
} catch (error) {
  die(error.message);
}
