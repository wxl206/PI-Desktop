/**
 * Behavior of the service search the add dialog offers (D311): the product
 * preset allowlist is listed once in the shared table's order, and a query
 * matches the localized label, canonical name, id, vendor key, aliases, base
 * URL or host — never an IPC round trip. Third-party presets and the custom
 * endpoint stay out of the add flow; legacy rows outside the allowlist keep
 * their editing path through the full shared table.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NAMED_ENDPOINT_PRESETS } from "@pi-desktop/shared";
import { PRODUCT_SCOPE } from "../src/lib/product-scope.ts";
import {
  CUSTOM_SERVICE,
  customServiceOption,
  filterServiceOptions,
  endpointLabel,
  namedServiceOptions,
  pluginProviderServiceOptions,
} from "../src/components/settings/service-catalog.ts";

// Stands in for i18next with localized labels, so a label-only match is
// distinguishable from a match on the canonical English name.
const labels = {
  "settings.presetCustomEndpoint": "自定义端点",
  "settings.presetDeepseek": "DeepSeek",
};
const translate = (key) => labels[key] ?? key;
const options = namedServiceOptions(translate);
const ids = (query) => filterServiceOptions(options, query).map((option) => option.id);

test("the add flow offers exactly the product presets, in shared-table order", () => {
  assert.deepEqual(
    namedServiceOptions(translate).map((option) => option.id),
    NAMED_ENDPOINT_PRESETS
      .map((preset) => preset.id)
      .filter((id) => PRODUCT_SCOPE.presetAllowlist.includes(id)),
  );
  assert.ok(namedServiceOptions(translate).length > 0, "the add flow keeps at least one preset");
});

test("third-party presets never enter the add flow, however the user searches", () => {
  for (const id of ["openai", "anthropic", "google", "openrouter", "stepfun-plan", "moonshotai-cn", "zhipuai"]) {
    assert.equal(namedServiceOptions(translate).some((option) => option.id === id), false, id);
  }
  for (const query of ["OpenAI", "ChatGPT", "gemini", "api.openai.com", "月之暗面", "KIMI", "api.moonshot.cn", "open.bigmodel.cn", "阶跃星辰"]) {
    assert.deepEqual(ids(query), [], query);
  }
});

test("DeepSeek is offered once and searchable by its label, vendor and endpoint", () => {
  const rows = namedServiceOptions(translate).filter((option) => option.id === "deepseek");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, labels["settings.presetDeepseek"]);
  assert.equal(rows[0].endpoint, "api.deepseek.com");
  for (const query of ["DeepSeek", "deepseek", "api.deepseek.com"]) {
    assert.ok(ids(query).includes("deepseek"), query);
  }
});

test("an empty or blank query keeps every option", () => {
  assert.deepEqual(ids(""), options.map((option) => option.id));
  assert.deepEqual(ids("   "), options.map((option) => option.id));
});

test("the custom endpoint keeps its option shape but stays out of the add flow", () => {
  const custom = customServiceOption(translate);
  assert.equal(custom.id, CUSTOM_SERVICE);
  assert.equal(custom.endpoint, "");
  assert.equal(namedServiceOptions(translate).some((option) => option.id === CUSTOM_SERVICE), false);
  assert.deepEqual(ids("自定义"), []);
  assert.deepEqual(ids("custom endpoint"), []);
});

test("an unmatched query yields no options", () => {
  assert.deepEqual(ids("no-such-service-anywhere"), []);
});

test("endpointLabel keeps unparseable input as-is", () => {
  assert.equal(endpointLabel("https://api.openai.com/v1"), "api.openai.com/v1");
  assert.equal(endpointLabel("not a url"), "not a url");
});


test("endpoint labels retain routes and ports without showing credentials or query fields", () => {
  assert.equal(endpointLabel("https://user:password@api.example:8443/plan/v1?key=private#fragment"),
    "api.example:8443/plan/v1");
  assert.equal(endpointLabel("https://api.example/"), "api.example");
});

test("plugin provider categories show only unconfigured API-key rows and search introductions", () => {
  const provider = (id, ownerPluginId, hasSecret) => ({
    id,
    name: id.endsWith("hcnsec") ? "幻城网安公益 API" : "ChatAnywhere Free API",
    vendorKey: "custom",
    type: "openai_compatible",
    protocol: "openai_compatible",
    enabled: true,
    baseUrl: id.endsWith("hcnsec")
      ? "https://api.ifivem.com/v1"
      : "https://api.chatanywhere.tech/v1",
    authKind: "api_key",
    hasSecret,
    models: [{ id: "deepseek-chat" }],
    supportsReasoning: false,
    supportedThinkingLevels: [],
    ownerPluginId,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  });
  const providers = [
    provider("plugin:community.ai-sites:hcnsec", "community.ai-sites", false),
    provider("plugin:community.ai-sites:chatanywhere", "community.ai-sites", true),
    { ...provider("plugin:community.ai-sites:disabled", "community.ai-sites", false), enabled: false },
    provider("plugin:other:wrong-owner", "other", false),
    { ...provider("plugin:community.ai-sites:oauth", "community.ai-sites", false), authKind: "oauth" },
    { ...provider("plugin:community.ai-sites:no-endpoint", "community.ai-sites", false), baseUrl: undefined },
  ];
  const declarations = [
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:community.ai-sites:hcnsec",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "签到获得额度的公益 API 服务。",
    },
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:community.ai-sites:chatanywhere",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "签到获得额度的公益 API 服务。",
    },
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:community.ai-sites:disabled",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "已停用的站点。",
    },
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:other:wrong-owner",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "其他站点。",
    },
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:community.ai-sites:oauth",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "OAuth 站点。",
    },
    {
      pluginId: "community.ai-sites",
      providerId: "plugin:community.ai-sites:no-endpoint",
      pluginName: "PI Community AI Sites",
      category: "公益站",
      description: "缺少地址。",
    },
  ];

  const options = pluginProviderServiceOptions(declarations, providers);
  assert.equal(options.length, 1);
  assert.equal(options[0].category, "公益站");
  assert.equal(options[0].endpoint, "api.ifivem.com/v1 · PI Community AI Sites");
  assert.equal(options[0].description, "签到获得额度的公益 API 服务。");
  assert.deepEqual(filterServiceOptions(options, "deepseek-chat").map((option) => option.id), [
    "plugin:community.ai-sites:hcnsec",
  ]);
  assert.deepEqual(filterServiceOptions(options, "公益站").map((option) => option.id), [
    "plugin:community.ai-sites:hcnsec",
  ]);
  assert.deepEqual(filterServiceOptions(options, "签到获得额度").map((option) => option.id), [
    "plugin:community.ai-sites:hcnsec",
  ]);
});
