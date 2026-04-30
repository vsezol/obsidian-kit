import { readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "manifest.json"), "utf8")
);

function readVaultPath() {
  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH;
  }
  const file = join(repoRoot, ".vault-path");
  if (!existsSync(file)) {
    throw new Error(
      "Vault path not configured. Create .vault-path with the absolute path " +
        "to your vault (one line), or set OBSIDIAN_VAULT_PATH."
    );
  }
  const value = readFileSync(file, "utf8").trim();
  if (!value) throw new Error(".vault-path is empty.");
  return value;
}

const vaultPath = readVaultPath();
const targetDir = join(vaultPath, ".obsidian", "plugins", manifest.id);

if (!existsSync(vaultPath)) {
  console.error(`Vault path does not exist: ${vaultPath}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
  const src = join(repoRoot, f);
  if (!existsSync(src)) {
    console.error(`Missing build artifact: ${f}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  copyFileSync(src, join(targetDir, f));
  console.log(`✓ ${f}`);
}

console.log(`\nDeployed ${manifest.name} v${manifest.version} → ${targetDir}`);
console.log("Reload Obsidian (or toggle the plugin off/on) to pick up changes.");
