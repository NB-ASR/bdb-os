import { readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("A SQL file path is required.");

function minifySql(source) {
  let output = "";
  let index = 0;
  let pendingSpace = false;

  const emit = (value) => {
    if (pendingSpace && output.length > 0) output += " ";
    pendingSpace = false;
    output += value;
  };

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (/\s/.test(current)) {
      pendingSpace = true;
      index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      pendingSpace = true;
      continue;
    }

    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      pendingSpace = true;
      continue;
    }

    if (current === "'" || current === '"') {
      const quote = current;
      let literal = quote;
      index += 1;
      while (index < source.length) {
        literal += source[index];
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            literal += source[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      emit(literal);
      continue;
    }

    if (current === "$") {
      const tag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const bodyStart = index + tag.length;
        const bodyEnd = source.indexOf(tag, bodyStart);
        if (bodyEnd < 0) throw new Error(`Unclosed dollar quote ${tag}.`);
        emit(`${tag}${minifySql(source.slice(bodyStart, bodyEnd))}${tag}`);
        index = bodyEnd + tag.length;
        continue;
      }
    }

    emit(current);
    index += 1;
  }

  return output.trim() + "\n";
}

const source = await readFile(sourcePath, "utf8");
await writeFile(sourcePath, minifySql(source), "utf8");
