/**
 * AMP upstream CLI command registration.
 */

import type { Command } from "commander";

import {
  formatAmpUpstreamApplyReport,
  formatAmpUpstreamListReport,
  formatAmpUpstreamPollReport,
  formatAmpUpstreamReviewReport,
  runAmpUpstreamApply,
  runAmpUpstreamDismiss,
  runAmpUpstreamList,
  runAmpUpstreamPoll,
  runAmpUpstreamReview,
  runAmpUpstreamSubscribe,
  runAmpUpstreamUnsubscribe,
} from "./upstream.js";

/** Register `amp upstream` subcommands on the AMP command group. */
export function registerAmpUpstreamCommands(amp: Command): Command {
  const upstream = amp
    .command("upstream")
    .description("Upstream sync — subscribe, poll, review, apply, dismiss");

  upstream
    .command("subscribe")
    .description("Subscribe to an upstream source (stub: fixture URLs in this release)")
    .argument("<url>", "Upstream URL (stub:/path/to/fixture for local fixtures)")
    .option("--ref <ref>", "Pinned upstream ref")
    .option("--poll <cadence>", "Poll cadence label (e.g. daily)")
    .option(
      "--policy <policy>",
      "Conflict policy: local-wins, upstream-wins, or prompt"
    )
    .option("--id <id>", "Subscription id override")
    .action(
      async (
        url: string,
        opts: { ref?: string; poll?: string; policy?: string; id?: string }
      ) => {
        const policy =
          opts.policy === "local-wins" ||
          opts.policy === "upstream-wins" ||
          opts.policy === "prompt"
            ? opts.policy
            : undefined;
        const result = await runAmpUpstreamSubscribe({
          url,
          ref: opts.ref,
          poll: opts.poll,
          policy,
          id: opts.id,
        });
        process.stdout.write(`Subscribed: ${result.id}\n`);
      }
    );

  upstream
    .command("unsubscribe")
    .description("Remove an upstream subscription")
    .argument("<id>", "Subscription id")
    .action(async (id: string) => {
      await runAmpUpstreamUnsubscribe({ id });
      process.stdout.write(`Unsubscribed: ${id}\n`);
    });

  upstream
    .command("list")
    .description("List subscriptions and changesets")
    .action(async () => {
      const result = await runAmpUpstreamList();
      for (const line of formatAmpUpstreamListReport(result)) {
        process.stdout.write(`${line}\n`);
      }
    });

  upstream
    .command("review")
    .description("Review a changeset (structured diff)")
    .argument("<id>", "Changeset id")
    .option("--json", "Machine-readable JSON output")
    .action(async (id: string, opts: { json?: boolean }) => {
      const result = await runAmpUpstreamReview({ id, json: opts.json });
      if (!result.ok) {
        process.stderr.write(`${result.error}\n`);
        process.exitCode = 1;
        return;
      }
      for (const line of formatAmpUpstreamReviewReport(result)) {
        process.stdout.write(`${line}\n`);
      }
    });

  upstream
    .command("apply")
    .description("Apply a pending upstream changeset")
    .argument("<id>", "Changeset id")
    .option("--project-root <path>", "Project root")
    .option("--only <names...>", "Apply only these procedure names or categories (added, updated, removed)")
    .option("--exclude <patterns...>", "Exclude procedure names matching patterns")
    .option("--confirm-breaking", "Required for high-risk changesets")
    .option("--accept-upstream <names...>", "Accept upstream over local concurrent edits")
    .action(
      async (
        id: string,
        opts: {
          projectRoot?: string;
          only?: string[];
          exclude?: string[];
          confirmBreaking?: boolean;
          acceptUpstream?: string[];
        }
      ) => {
        const result = await runAmpUpstreamApply({
          changesetId: id,
          projectRoot: opts.projectRoot,
          only: opts.only,
          exclude: opts.exclude,
          confirmBreaking: opts.confirmBreaking ?? false,
          acceptUpstream: opts.acceptUpstream,
        });
        for (const line of formatAmpUpstreamApplyReport(result)) {
          process.stdout.write(`${line}\n`);
        }
        if (!result.ok) {
          process.exitCode = 1;
        }
      }
    );

  upstream
    .command("dismiss")
    .description("Dismiss a changeset without applying")
    .argument("<id>", "Changeset id")
    .action(async (id: string) => {
      const result = await runAmpUpstreamDismiss({ id });
      if (!result.ok) {
        process.stderr.write(`${result.error}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`Dismissed: ${id}\n`);
    });

  upstream
    .command("poll")
    .description("Run upstream sync on demand (no scheduler)")
    .option("--project-root <path>", "Project root")
    .action(async (opts: { projectRoot?: string }) => {
      const result = await runAmpUpstreamPoll({ projectRoot: opts.projectRoot });
      for (const line of formatAmpUpstreamPollReport(result)) {
        process.stdout.write(`${line}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  return upstream;
}
