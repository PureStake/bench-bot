import { Writable } from "node:stream";
import * as path from "path";
import * as fs from "fs/promises";
import { OctokitService } from "../utils/github";
import { runTask } from "./runner";
import { addRemote, cloneMoonbeam, createBranch, setupBranch } from "./github";
import Debug from "debug";
const debug = Debug("actions:benchmark");

const cwd = process.cwd();

//::node::import::native::sr25519::transfer_keep_alive::paritydb::small

// const cargoRun = "cargo run --features=runtime-benchmarks --bin moonbeam -- ";
const cargoRun = "cargo run ";

interface BenchRunConfig {
  // Branch to run the benchmark against
  branch: string;

  // Access to repos
  moonbeamRepo: OctokitService;
  forkRepo: OctokitService;

  // Parameters benchmark command (ex: "pallet author-mapping")
  commandParams: string;
}

// Subcommand executed
type Command = "runtime";
type SubCommand = "storage" | "pallet" | "block" | "overhead";

const ORIGINAL_REMOTE_NAME = "original";
const FORK_REMOTE_NAME = "fork";

async function prepareForkRepo({
  moonbeamRepo,
  forkRepo,
  branch,
}: BenchRunConfig) {
  const gitDirectory = path.join(cwd, "git");
  const moonbeamUrl = await moonbeamRepo.getAuthorizedUrl();
  const benchUrl = await forkRepo.getAuthorizedUrl();
  const forkBranch = `${branch}-benchbot-job-${new Date().getTime()}`;
  const repoDirectory = await cloneMoonbeam(
    moonbeamUrl,
    moonbeamRepo.owner,
    moonbeamRepo.repo,
    gitDirectory
  );
  await addRemote(
    repoDirectory,
    ORIGINAL_REMOTE_NAME,
    moonbeamUrl,
    moonbeamRepo.owner,
    moonbeamRepo.repo
  );
  await addRemote(
    repoDirectory,
    FORK_REMOTE_NAME,
    benchUrl,
    forkRepo.owner,
    forkRepo.repo
  );
  await setupBranch(repoDirectory, ORIGINAL_REMOTE_NAME, branch);
  await createBranch(repoDirectory, forkBranch);
  return { repoDirectory, forkBranch: forkBranch };
}

var SubcommandConfigs = {
  pallet: {
    title: "Runtime Pallet",
    benchCommand: [
      cargoRun,
      "--release",
      "--bin moonbeam",
      "--features=runtime-benchmarks",
      "--",
      "benchmark",
      "pallet",
      "--chain=dev",
      "--steps=50",
      "--repeat=20",
      "--pallet={pallet_name}",
      '--extrinsic="*"',
      "--execution=wasm",
      "--wasm-execution=compiled",
      "--heap-pages=4096",
      // "--header=./file_header.txt",
      "--template=./benchmarking/frame-weight-template.hbs",
      "--output=./pallets/{pallet_folder}/src/weights.rs",
    ].join(" "),
  },
};

function checkRuntimeBenchmarkCommand(command) {
  let required = [
    "benchmark",
    "--pallet",
    "--extrinsic",
    "--execution",
    "--wasm-execution",
    "--steps",
    "--repeat",
    "--chain",
  ];
  let missing: string[] = [];
  for (const flag of required) {
    if (!command.includes(flag)) {
      missing.push(flag);
    }
  }

  return missing;
}

function checkCommandSanity(command) {
  return !!/^[a-zA-Z\ \-]*$/.exec(command);
}

// Moonbeam's pallet naming is inconsistent in several ways:
// * the prefix "pallet-" being included or not in the crate name
// * pallet's dir name (maybe?)
// * where pallets are benchmarked (in their own repo or not)
//
// This function serves as a registry for all of this information.
function matchMoonbeamPallet(pallet: string) {
  switch (pallet) {
    // "companion"
    case "crowdloan-rewards":
      return {
        name: "crowdloan-rewards",
        benchmark: "pallet_crowdloan_rewards",
        dir: "crowdloan-rewards", // TODO: how can this be included in the moonbeam codebase?
      };
    // found directly in the moonbeam repo
    case "parachain-staking":
      return {
        name: "parachain-staking",
        benchmark: "parachain_staking",
        dir: "parachain-staking",
      };
    case "author-mapping":
      return {
        name: "author-mapping",
        benchmark: "pallet_author_mapping",
        dir: "author-mapping",
      };
    case "asset-manager":
      return {
        name: "asset-manager",
        benchmark: "pallet_asset_manager",
        dir: "asset-manager",
      };
  }

  throw new Error(`Pallet argument not recognized: ${pallet}`);
}

export async function benchmarkRuntime(config: BenchRunConfig) {
  debug("Waiting our turn to run benchmarkRuntime...");

  if (config.commandParams.split(" ").length < 2) {
    throw new Error(`Incomplete command.`);
  }

  const [subCommand, ...extraWords] = config.commandParams.split(" ");
  const subCommandExtra = extraWords.join(" ").trim();

  const subCommandConfig = SubcommandConfigs[subCommand];

  if (!checkCommandSanity(subCommandExtra)) {
    throw new Error(`Special characters not allowed`);
  }

  // Complete the command with pallet information
  const palletInfo = matchMoonbeamPallet(subCommandExtra.split(" ")[0]);
  const completeBenchCommand = subCommandConfig.benchCommand
    .replace("{pallet_name}", palletInfo.benchmark)
    .replace("{pallet_folder}", palletInfo.dir);

  let missing = checkRuntimeBenchmarkCommand(completeBenchCommand);
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.toString()}`);
  }

  debug(
    `Started ${subCommand} benchmark "${subCommandConfig.title}." (command: ${completeBenchCommand})`
  );

  // Also generates a unique branch
  const { forkBranch, repoDirectory } = await prepareForkRepo(config);

  const outputLine = completeBenchCommand.match(
    /--output(?:=|\s+)(".+?"|\S+)/
  )[1];
  if (!outputLine) {
    throw new Error(`Missing output file parameter`);
  }
  const outputFile = path.join(repoDirectory, outputLine);

  debug(`Output: ${outputFile}`);
  debug(`Running benchmark`);
  const logs = await runTask(
    completeBenchCommand,
    { cwd: repoDirectory },
    `Running for branch ${config.branch}, 
      outputFile: ${outputFile}: ${completeBenchCommand}`
  );

  const gitStatus = await runTask("git status --short", { cwd: repoDirectory });
  debug(`Git status after execution: ${gitStatus}`);

  if (process.env.DEBUG) {
    console.log(`Output file\n`);
    console.log(`${(await fs.readFile(outputFile)).toString()}\n`);
  } else {
    debug(`Commit new files`);
    await runTask(
      `git add ${outputLine} && git commit -m "${completeBenchCommand}"`,
      { cwd: repoDirectory }
    );
    debug(`Pushing new branch to fork repo`);
    await runTask(`git push ${FORK_REMOTE_NAME} ${forkBranch}`, {
      cwd: repoDirectory,
    });

    debug(`Creating new pull request`);
    const result = await (
      await config.forkRepo.getOctokit()
    ).rest.pulls.create(
      config.moonbeamRepo.extendRepoOwner({
        title: "Updated Weights",
        head: `${config.forkRepo.owner}:${forkBranch}`,
        base: config.branch,
        body: `Weights have been updated`, // TODO
        maintainer_can_modify: false,
      })
    );
    return {
      logs,
      repoDirectory,
      pullNumber: result.data.number,
      outputFile,
      prBranch: forkBranch,
      benchCommand: completeBenchCommand,
    };
  }
  return {
    logs,
    repoDirectory,
    pullNumber: null,
    outputFile,
    prBranch: forkBranch,
    benchCommand: completeBenchCommand,
  };
}
