# mygit

Tiny Git-style version control for learning how commits, branches, and stored objects work.

Data lives in `.mygit`.

Commands:

- `init` create the repo
- `add` stage files
- `commit` save a snapshot
- `status` show changes
- `log` show history
- `branch` list or create branches
- `checkout` switch branches
- `cat-file` print an object

## Example

```bash
node git.js init
echo "notes" > notes.txt
node git.js add notes.txt
node git.js commit -m "first commit"
node git.js log
node git.js branch work
node git.js checkout work
```
