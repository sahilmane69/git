# mygit

A small version control project for understanding how Git stores files,
commits, and branches.

Data is kept in `.mygit`. Commands available:

- `init`
- `add`
- `commit`
- `status`
- `log`
- `branch`
- `checkout`
- `cat-file`

## Try it

```bash
node git.js init
echo "project notes" > notes.txt
node git.js add notes.txt
node git.js commit -m "add notes"
node git.js status
node git.js log
```

Create and switch branches:

```bash
node git.js branch work
node git.js checkout work
```

Inspect a stored object:

```bash
node git.js cat-file <object-id>
```

The project uses content-addressed objects, compressed storage, an index,
commits, refs, and branches.
