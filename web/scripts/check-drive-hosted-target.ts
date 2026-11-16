import { hostedSite, TEST_REPOSITORY } from "../drive-diagnostic/runtime.ts";
import { pathToFileURL } from "node:url";
export function deploymentTarget(
  repository: string,
  approved: string,
  sourceRef: string,
) {
  const [owner, name, ...extra] = repository.split("/");
  if (
    extra.length ||
    !owner ||
    !/^[-a-zA-Z0-9]+$/.test(owner) ||
    owner.toLowerCase() === "shivam9400" ||
    name !== TEST_REPOSITORY ||
    approved.toLowerCase() !== repository.toLowerCase() ||
    !/^[a-f0-9]{40}$/.test(sourceRef)
  )
    throw new Error(
      "Deployment refused: use the explicitly approved dedicated test repository under a different owner and a reviewed full source SHA.",
    );
  return hostedSite(
    `https://${owner.toLowerCase()}.github.io/${TEST_REPOSITORY}/`,
  );
}
export function verifyPages(page: unknown, url: string) {
  const value = page as {
    cname?: unknown;
    html_url?: unknown;
    build_type?: unknown;
  };
  if (
    !value ||
    value.cname ||
    typeof value.html_url !== "string" ||
    hostedSite(value.html_url).url !== url ||
    value.build_type !== "workflow"
  )
    throw new Error(
      "Pages target mismatch/custom domain: no publication allowed. Enable Actions Pages only in the dedicated test repository.",
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const target = deploymentTarget(
    process.env.GITHUB_REPOSITORY ?? "",
    process.env.APPROVED_DIAGNOSTIC_REPOSITORY ?? "",
    process.env.SOURCE_REF ?? "",
  );
  if (process.env.CHECK_PAGES === "true") {
    const repo = process.env.GITHUB_REPOSITORY!,
      token = process.env.GH_TOKEN;
    if (!token) throw new Error("Missing job-scoped GitHub token.");
    const response = await fetch(`https://api.github.com/repos/${repo}/pages`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        "Cannot verify the test repository's Pages configuration. No deploy performed.",
      );
    verifyPages(await response.json(), target.url);
  }
  console.log(`Approved isolated test target: ${target.url}`);
}
