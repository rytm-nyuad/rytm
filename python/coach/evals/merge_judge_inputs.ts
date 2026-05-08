import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });
dotenv.config();

const EVALS_DIR = path.join(process.cwd(), "python", "coach", "evals");
const GENERATION_RUNS_DIR = path.join(EVALS_DIR, "runs", "generation");
const MERGED_RUNS_DIR = path.join(EVALS_DIR, "runs", "merged_inputs");

type SourceRun = {
  runId: string;
  runDir: string;
  manifestPath: string | null;
  judgeInputsDir: string;
  manifest: Record<string, unknown> | null;
};

function usage(): never {
  throw new Error(
    "Usage: npm run coach-evals:merge -- <generation-run-id-or-path> <generation-run-id-or-path> [...]"
  );
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function makeRunId(prefix: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}__${stamp}`;
}

function resolveRunDir(input: string): string {
  if (path.isAbsolute(input)) {
    return input;
  }

  const directPath = path.join(process.cwd(), input);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    return directPath;
  }

  return path.join(GENERATION_RUNS_DIR, input);
}

function loadSourceRun(input: string): SourceRun {
  const runDir = resolveRunDir(input);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    throw new Error(`Generation run directory not found: ${input}`);
  }

  const runId = path.basename(runDir);
  const manifestPath = path.join(runDir, "manifest.json");
  const judgeInputsDir = path.join(runDir, "judge_inputs");

  if (!fs.existsSync(judgeInputsDir) || !fs.statSync(judgeInputsDir).isDirectory()) {
    throw new Error(`Missing judge_inputs directory in ${runDir}`);
  }

  const manifest =
    fs.existsSync(manifestPath)
      ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
      : null;

  return {
    runId,
    runDir,
    manifestPath: fs.existsSync(manifestPath) ? manifestPath : null,
    judgeInputsDir,
    manifest,
  };
}

function copyUniqueFiles(sourceRuns: SourceRun[], targetDir: string) {
  const seenNames = new Set<string>();
  const copiedFiles: Array<{ fileName: string; sourceRunId: string }> = [];

  for (const sourceRun of sourceRuns) {
    const fileNames = fs
      .readdirSync(sourceRun.judgeInputsDir)
      .filter((name) => name.endsWith(".json"))
      .sort();

    for (const fileName of fileNames) {
      if (seenNames.has(fileName)) {
        throw new Error(
          `Duplicate judge input filename detected: ${fileName}. ` +
            `This usually means overlapping dates or replay collisions across source runs.`
        );
      }

      seenNames.add(fileName);
      fs.copyFileSync(
        path.join(sourceRun.judgeInputsDir, fileName),
        path.join(targetDir, fileName)
      );
      copiedFiles.push({
        fileName,
        sourceRunId: sourceRun.runId,
      });
    }
  }

  return copiedFiles;
}

async function main() {
  const inputs = process.argv.slice(2);
  if (inputs.length < 2) {
    usage();
  }

  const sourceRuns = inputs.map(loadSourceRun);
  const mergedRunId = makeRunId("merged_inputs");
  const mergedRunDir = path.join(MERGED_RUNS_DIR, mergedRunId);
  const mergedInputsDir = path.join(mergedRunDir, "judge_inputs");
  ensureDir(mergedInputsDir);

  const copiedFiles = copyUniqueFiles(sourceRuns, mergedInputsDir);

  const manifest = {
    run_id: mergedRunId,
    created_at: new Date().toISOString(),
    source_runs: sourceRuns.map((sourceRun) => ({
      run_id: sourceRun.runId,
      run_dir: sourceRun.runDir,
      manifest_path: sourceRun.manifestPath,
      judge_inputs_dir: sourceRun.judgeInputsDir,
      manifest: sourceRun.manifest,
    })),
    merged_inputs_dir: mergedInputsDir,
    copied_file_count: copiedFiles.length,
    copied_files: copiedFiles,
  };

  const manifestPath = path.join(mergedRunDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`[coach-evals:merge] merged_inputs_dir=${mergedInputsDir}`);
  console.log(`[coach-evals:merge] manifest=${manifestPath}`);
}

void main();
