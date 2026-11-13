import { readAppSource, readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  english,
  chinese,
  brandLogo,
  icons,
  sidebar,
  app,
  chatSurface,
  composer,
  styles,
  mascotLogo,
  rendererLanguage,
] = await Promise.all([
    read("../../../packages/i18n/src/locales/en/index.ts"),
    read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
    read("../src/components/BrandLogo.tsx"),
    read("../src/components/icons.tsx"),
    read("../src/components/Sidebar.tsx"),
    readAppSource(),
    read("../src/components/ChatSurface.tsx"),
    readComposerSource(),
    loadStyles(),
    read("../src/components/HomeMascotLogo.tsx"),
    read("../src/lib/renderer-language.ts"),
  ]);

test("renderer surfaces the PI-Desktop brand instead of the Codex shell brand", () => {
  assert.match(english, /shellName:\s*"PI-Desktop"/);
  assert.match(chinese, /shellName:\s*"PI-Desktop"/);
  assert.match(english, /placeholder:\s*"Ask PI-Desktop to help with anything"/);
  assert.match(chinese, /placeholder:\s*"让 PI-Desktop 帮你做任何事"/);
  assert.doesNotMatch(english, /shellName:\s*"Codex"/);
  assert.doesNotMatch(chinese, /shellName:\s*"Codex"/);
  // Codex remains a supported external import source, not the app identity.
  assert.match(english, /importSourceCodex:\s*"Codex"/);
  assert.match(chinese, /importSourceCodex:\s*"Codex"/);
});

test("app chrome uses the shared brand asset without branding the composer input", async () => {
  // One cropped, theme-neutral Iterate mark serves both light and dark chrome.
  assert.match(
    brandLogo,
    /import iterateLogoUrl from\s*"\.\.\/assets\/brand\/iterate-logo\.png"/,
  );
  assert.doesNotMatch(brandLogo, /logo-light|logo-dark|useEffect|useState/);
  assert.doesNotMatch(brandLogo, /\.\.\/\.\.\/build\//);
  assert.match(brandLogo, /export function BrandLogo/);
  assert.match(brandLogo, /src=\{iterateLogoUrl\}/);
  assert.match(icons, /export const IconNewSession/);
  assert.doesNotMatch(icons, /IconCodexHome|IconCompose|IconPiMark|IconPiHome/);
  const rendererMark = await readFile(
    new URL("../src/assets/brand/iterate-logo.png", import.meta.url),
  );
  assert.deepEqual([...rendererMark.subarray(0, 8)], [
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  assert.equal(rendererMark.readUInt32BE(16), 448);
  assert.equal(rendererMark.readUInt32BE(20), 214);
  await assert.rejects(
    () => access(new URL("../src/assets/brand/logo-light.png", import.meta.url)),
  );
  await assert.rejects(
    () => access(new URL("../src/assets/brand/logo-dark.png", import.meta.url)),
  );
  await assert.rejects(
    () => access(new URL("../src/assets/home-mascot-dark.gif", import.meta.url)),
  );
  await assert.rejects(
    () => access(new URL("../src/assets/home-mascot-light.gif", import.meta.url)),
  );
  assert.match(chatSurface, /<HomeMascotLogo \/>/);
  assert.match(
    mascotLogo,
    /import iterateLogoUrl from\s*"\.\.\/assets\/brand\/iterate-logo\.png"/,
  );
  assert.match(mascotLogo, /className="home-mascot-logo"/);
  assert.match(mascotLogo, /aria-hidden="true"/);
  assert.match(mascotLogo, /className="home-product-mark"/);
  assert.match(mascotLogo, /src=\{iterateLogoUrl\}/);
  assert.doesNotMatch(mascotLogo, /<svg/);
  assert.doesNotMatch(
    mascotLogo,
    /home-mascot-(?:motion|still|orbit|groups)|Math\.random\(\)|setTimeout|backgroundPosition|onMouseEnter|onMouseLeave|useState|useEffect|matchMedia/,
  );
  assert.doesNotMatch(chatSurface, /<BrandLogo/);
  assert.match(styles, /\.empty-hero-icon\s*\{[\s\S]*?height:\s*100px;[\s\S]*?width:\s*100px;/);
  assert.match(
    styles,
    /\.home-mascot-logo\s*\{[\s\S]*?display:\s*block;[\s\S]*?width:\s*100px;[\s\S]*?height:\s*100px;/,
  );
  assert.match(styles, /\.home-mascot-logo \.home-product-mark\s*\{[\s\S]*?object-fit:\s*contain;/);
  assert.doesNotMatch(styles, /\.home-mascot-(?:motion|still)|home-mascot-light|home-mascot-dark/);
  assert.match(
    rendererLanguage,
    /if \(request === languageRequest\)\s*document\.documentElement\.lang = target/,
  );
  assert.doesNotMatch(styles, /@keyframes home-mascot-orbit|@keyframes home-mascot-breathe|@keyframes home-mascot-blink/);
  assert.doesNotMatch(styles, /background-size:\s*5000px 100px|image-rendering:\s*pixelated/);
  assert.doesNotMatch(composer, /<BrandLogo/);
  assert.doesNotMatch(composer, /composer-thread-mark/);
  assert.doesNotMatch(styles, /\.composer-thread-mark/);
  assert.doesNotMatch(styles, /\.composer-input-wrap\s*\{[^}]*\bgap:/s);
  assert.doesNotMatch(composer, /infinity-mark|∞/);
  assert.match(sidebar, /<BrandLogo\s+size=\{20\}/);
  assert.match(sidebar, /IconNewSession/);
  assert.match(app, /<IconNewSession\s+size=\{15\}/);
  assert.doesNotMatch(sidebar, /IconCompose|IconPiMark|IconPiHome/);
});
