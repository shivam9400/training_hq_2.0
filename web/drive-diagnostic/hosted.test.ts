import { it, expect } from "vitest";
import {
  assertRuntime,
  codespaceSite,
  csp,
  hostedSite,
  publicSettings,
} from "./runtime";
import {
  deploymentTarget,
  verifyPages,
} from "../scripts/check-drive-hosted-target";
const site = "https://synthetic-test-owner.github.io/training-hq-drive-test/";
const sha = "a".repeat(40);
it("allows only the separate HTTPS test-owner origin and fixed repository path", () => {
  expect(hostedSite(site).origin).toBe(
    "https://synthetic-test-owner.github.io",
  );
  for (const url of [
    "https://shivam9400.github.io/training-hq-drive-test/",
    "https://shivam9400.github.io/training_hq_2.0/",
    "http://synthetic-test-owner.github.io/training-hq-drive-test/",
    "https://synthetic-test-owner.github.io/",
    "https://evil.example/training-hq-drive-test/",
    site + "?client_id=synthetic",
    site + "#token",
    site.replace("https://", "https://u:p@"),
  ])
    expect(() => hostedSite(url)).toThrow();
});
it("refuses wrong hosted origin, path, query, fragment and framed execution", () => {
  expect(() => assertRuntime("hosted", site, site, false)).not.toThrow();
  expect(() =>
    assertRuntime("hosted", site, site + "index.html", false),
  ).not.toThrow();
  for (const url of [
    site.replace("synthetic-test-owner", "other"),
    site + "callback",
    site + "?access_token=fake",
    site + "#token",
    "https://shivam9400.github.io/training_hq_2.0/",
  ])
    expect(() => assertRuntime("hosted", site, url, false)).toThrow();
  expect(() => assertRuntime("hosted", site, site, false, true)).toThrow();
  expect(() =>
    assertRuntime(
      "local",
      "http://localhost:5173/",
      "http://localhost:5173/",
      true,
    ),
  ).not.toThrow();
  expect(() =>
    assertRuntime(
      "local",
      "http://localhost:5173/",
      "http://localhost:5173/",
      false,
    ),
  ).toThrow();
});
it("derives a private Codespace exact origin without a wildcard allowlist", () => {
  const url = codespaceSite("synthetic-space", "app.github.dev");
  expect(() => assertRuntime("codespace", url, url, true)).not.toThrow();
  expect(() => assertRuntime("codespace", url, url, false)).toThrow();
  expect(() => codespaceSite("../other", "app.github.dev")).toThrow();
  expect(() => codespaceSite("space", "evil.example")).toThrow();
  expect(csp("hosted", new URL(site).origin)).not.toContain("unsafe-eval");
  expect(csp("hosted", new URL(site).origin)).not.toContain("ws:");
  expect(csp("hosted", new URL(site).origin)).not.toContain("firestore");
});
it("deployment guards cannot target the production repository, origin or another repo", () => {
  expect(
    deploymentTarget(
      "synthetic-test-owner/training-hq-drive-test",
      "synthetic-test-owner/training-hq-drive-test",
      sha,
    ).url,
  ).toBe(site);
  for (const repo of [
    "shivam9400/training_hq_2.0",
    "shivam9400/training-hq-drive-test",
    "synthetic-test-owner/other",
    "synthetic-test-owner/training-hq-drive-test/extra",
  ])
    expect(() => deploymentTarget(repo, repo, sha)).toThrow();
  expect(() =>
    deploymentTarget(
      "synthetic-test-owner/training-hq-drive-test",
      "different/repo",
      sha,
    ),
  ).toThrow();
  expect(() =>
    deploymentTarget(
      "synthetic-test-owner/training-hq-drive-test",
      "synthetic-test-owner/training-hq-drive-test",
      "main",
    ),
  ).toThrow();
});
it("verifies actual Pages URL, Actions source and absence of custom-domain mapping", () => {
  const page = { cname: null, html_url: site, build_type: "workflow" };
  expect(() => verifyPages(page, site)).not.toThrow();
  for (const patch of [
    { cname: "example.invalid" },
    { html_url: "https://shivam9400.github.io/training_hq_2.0/" },
    { build_type: "legacy" },
    { html_url: site.replace("synthetic-test-owner", "other") },
  ])
    expect(() => verifyPages({ ...page, ...patch }, site)).toThrow();
});
it("accepts only public test settings and rejects secret-shaped or malformed values", () => {
  const settings = {
    clientId: "synthetic.apps.googleusercontent.com",
    pickerKey: "synthetic-key",
    appId: "123456",
  };
  expect(publicSettings(settings)).toEqual(settings);
  for (const patch of [
    { clientId: "old-or-invalid" },
    { pickerKey: "GOCSPX-synthetic-secret-not-real" },
    { appId: "not-a-number" },
    { pickerKey: "" },
  ])
    expect(() => publicSettings({ ...settings, ...patch })).toThrow();
});
