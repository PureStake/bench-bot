import { benchmarkRuntime, benchRustup } from "../actions/bench"
import { GlobalConfig } from "../utils/config"
import * as shell from "shelljs"
import { COMMENT_MAX_LENGTH, COMMENT_TRUNCATED_POSTFIX } from "../utils/github"

export const COMMAND_PREFIX = "/bench"

export async function run(app, globalConfig: GlobalConfig, context) {
  try {
    const sourceInstallationId = (context.payload.installation || {}).id
    if (!sourceInstallationId) {
      await context.octokit.issues.createComment(
        context.issue({
          body: `Error: Installation id was missing from webhook payload`,
        }),
      )
      app.log.error("Installation id was missing from webhook payload")
      return
    } else if (sourceInstallationId != globalConfig.installationId) {
      console.log(
        `Warning: ignoring payload from irrelevant installation ${sourceInstallationId}`,
      )
      return
    }

    const getPushDomain = async function () {
      const token = (
        await globalConfig.authInstallation({
          type: "installation",
          installationId: globalConfig.installationId,
        })
      ).token

      const url = `https://x-access-token:${token}@github.com`
      return { url, token }
    }

    const getBBPushDomain = async function () {
      const token = (
        await globalConfig.bbAuthInstallation({
          type: "installation",
          installationId: globalConfig.bbInstallationId,
        })
      ).token

      const url = `https://x-access-token:${token}@github.com`
      return { url, token }
    }

    const repo = context.payload.repository.name
    const owner = context.payload.repository.owner.login
    const pull_number = context.payload.issue.number

    let commentText = context.payload.comment.body
    // Capture `<action>` in `/bench <action> <extra>`
    let [action, ...extra] = commentText
      .slice(COMMAND_PREFIX.length)
      .trim()
      .split(" ")
    extra = extra.join(" ").trim()

    let pr = await context.octokit.pulls.get({ owner, repo, pull_number })
    const contributor = pr.data.head.user.login
    const branch = pr.data.head.ref
    app.log.debug(`branch: ${branch}`)

    var { stdout: toolchain, code: toolchainError } = shell.exec(
      "rustup show active-toolchain --verbose",
      { silent: false },
    )
    if (toolchainError) {
      await context.octokit.issues.createComment(
        context.issue({
          body: "ERROR: Failed to query the currently active Rust toolchain",
        }),
      )
      app.log.fatal(
        "ERROR: Failed to query the currently active Rust toolchain",
      )
      return
    } else {
      toolchain = toolchain.trim()
    }

    // generate a unique branch for our PR
    const bbBranch = `${branch}-benchbot-job-${new Date().getTime()}`

    const initialInfo = `Starting benchmark for branch: ${branch} (vs ${globalConfig.baseBranch})\nPR branch will be ${bbBranch}\n\nToolchain: \n${toolchain}\n\n Comment will be updated.`
    let comment_id = undefined

    app.log(initialInfo)
    const issueComment = context.issue({ body: initialInfo })
    const issue_comment = await context.octokit.issues.createComment(
      issueComment,
    )
    comment_id = issue_comment.data.id

    let config = {
      owner,
      contributor,
      repo,
      bbRepo: globalConfig.bbRepo,
      bbRepoOwner: globalConfig.bbRepoOwner,
      bbBranch,
      branch,
      baseBranch: globalConfig.baseBranch,
      id: action,
      extra,
      getPushDomain,
      getBBPushDomain,
    }

    // kick off the build/run process...
    let report
    if (action == "runtime" || action == "xcm") {
      report = await benchmarkRuntime(app, config, context.octokit)
    } else if (action == "rustup") {
      report = await benchRustup(app, config)
    } else {
      report = {
        isError: true,
        message: "Unsupported action",
        error: `unsupported action: ${action}`,
      }
    }
    if (process.env.DEBUG) {
      console.log(report)
      return
    }

    if (report.isError) {
      app.log.error(report.message)

      if (report.error) {
        app.log.error(report.error)
      }

      const output = `${report.message}${
        report.error ? `: ${report.error.toString()}` : ""
      }`

      /*
      await context.octokit.issues.updateComment({
        owner,
        repo,
        comment_id,
        body: `Error running benchmark: **${branch}**\n\n<details><summary>stdout</summary>${output}</details>`,
      })
      */

      return
    }

    let { title, output, extraInfo, benchCommand } = report

    const bodyPrefix = `
Benchmark **${title}** for branch "${branch}" with command ${benchCommand}

Toolchain: ${toolchain}

<details>
<summary>Results</summary>

\`\`\`
`.trim()

    const bodySuffix = `
\`\`\`

</details>
`.trim()

    const padding = 16
    const formattingLength =
      bodyPrefix.length + bodySuffix.length + extraInfo.length + padding
    const length = formattingLength + output.length
    if (length >= COMMENT_MAX_LENGTH) {
      output = `${output.slice(
        0,
        COMMENT_MAX_LENGTH -
          (COMMENT_TRUNCATED_POSTFIX.length + formattingLength),
      )}${COMMENT_TRUNCATED_POSTFIX}`
    }

    const body = `
${bodyPrefix}
${output}
${bodySuffix}

${extraInfo}
`.trim()

    await context.octokit.issues.updateComment({
      owner,
      repo,
      comment_id,
      body,
    })
  } catch (error) {
    console.log(error)

    app.log.fatal({
      error,
      repo: globalConfig.bbRepo,
      owner: globalConfig.bbRepoOwner,
      baseBranch: globalConfig.baseBranch,
      msg: "Caught exception in issue_comment's handler",
    })
    await context.octokit.issues.createComment(
      context.issue({
        body: `Exception caught: \`${error.message}\`\n${error.stack}`,
      }),
    )
  }
}
