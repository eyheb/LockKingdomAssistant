import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const rawRoot = path.join(projectRoot, "materials", "raw", "biligame-spirit-details");
const dataRoot = path.join(projectRoot, "data");
const dexPath = path.join(dataRoot, "biligame-spirit-dex.json");
const outputJson = path.join(dataRoot, "biligame-spirit-details.json");
const sourceRoot = "https://wiki.biligame.com/rocom/";
const delayMs = Number(process.env.BILIGAME_DETAIL_DELAY_MS || 180);
const retryCount = Number(process.env.BILIGAME_DETAIL_RETRIES || 4);
let challengeCookie = "";
const sampleNames = (process.env.BILIGAME_DETAIL_SAMPLE || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const statKeys = {
  生命: "hp",
  物攻: "physicalAttack",
  魔攻: "magicAttack",
  物防: "physicalDefense",
  魔防: "magicDefense",
  速度: "speed"
};

function compactString(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map(compactString).filter(Boolean))];
}

function decodeHtml(value) {
  return compactString(value)
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#160;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, ""));
}

function attr(block, name) {
  const match = block.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function absoluteWikiUrl(href) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  return new URL(href, "https://wiki.biligame.com").toString();
}

function cleanImageUrl(url) {
  if (!url) return "";
  const absolute = absoluteWikiUrl(url);
  const match = absolute.match(/^(https?:\/\/patchwiki\.biligame\.com\/images\/rocom)\/thumb\/(.+?\.png)(?:\/\d+px-.+)?$/i);
  return match ? `${match[1]}/${match[2]}` : absolute;
}

function pageSlug(spirit) {
  const url = new URL(spirit.wikiUrl);
  return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || spirit.name);
}

function safeFilename(spirit) {
  return `${spirit.number}-${pageSlug(spirit).replace(/[\\/:*?"<>|]/g, "_")}.html`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(spirit) {
  fs.mkdirSync(rawRoot, { recursive: true });
  const filePath = path.join(rawRoot, safeFilename(spirit));
  if (fs.existsSync(filePath)) {
    const cached = fs.readFileSync(filePath, "utf8");
    if (isValidDetailHtml(cached)) return cached;
    fs.rmSync(filePath, { force: true });
  }

  let response;
  let error;
  let html = "";
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      response = await fetch(spirit.wikiUrl, {
        headers: {
          "user-agent": "Mozilla/5.0",
          ...(challengeCookie ? { cookie: challengeCookie } : {})
        }
      });

      html = await response.text();
      if (response.ok && isValidDetailHtml(html)) break;
      const solvedCookie = solveChallengeCookie(html);
      if (solvedCookie) challengeCookie = mergeCookie(challengeCookie, solvedCookie);
      error = new Error(response.ok ? "received anti-bot challenge page" : `${response.status} ${response.statusText}`);
    } catch (fetchError) {
      error = fetchError;
    }

    if (attempt < retryCount) {
      await sleep(delayMs + attempt * 500);
    }
  }

  if (!response?.ok || !isValidDetailHtml(html)) {
    throw new Error(`Failed to download ${spirit.name}: ${error?.message || "unknown error"}`);
  }

  fs.writeFileSync(filePath, html, "utf8");
  if (delayMs > 0) await sleep(delayMs);
  return html;
}

function isValidDetailHtml(html) {
  return html.includes("rocom_sprite_info") || html.includes("rocom_sprite_skill_box") || html.includes("isla_rocom_sprite");
}

function solveChallengeCookie(html) {
  if (!html.includes("__tst_status") || !html.includes("EO_Bot_Ssid")) return "";
  const values = [...html.matchAll(/(?:WTKkN|bOYDu|wyeCN):(\d+)/g)].map((match) => Number(match[1]));
  const eoMatch = html.match(/t=a\[_0x649a\("0x7"\)\]\(t,(\d+)\)/);
  if (values.length < 3 || !eoMatch) return "";
  const status = values.reduce((sum, value) => sum + value, 0);
  return `__tst_status=${status}#; EO_Bot_Ssid=${eoMatch[1]}`;
}

function mergeCookie(current, addition) {
  const entries = new Map();
  for (const cookie of [current, addition]) {
    String(cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        const index = item.indexOf("=");
        if (index !== -1) entries.set(item.slice(0, index), item.slice(index + 1));
      });
  }
  return [...entries].map(([key, value]) => `${key}=${value}`).join("; ");
}

function firstMatch(html, regex) {
  return html.match(regex)?.[1] || "";
}

function lastUnique(values) {
  return unique(values).at(-1) || "";
}

function parseStats(html) {
  const names = [...html.matchAll(/rocom_sprite_info_qualification_name[^>]*>([\s\S]*?)<\/p>/g)].map((match) => stripTags(match[1]));
  const values = [...html.matchAll(/rocom_sprite_info_qualification_value[^>]*>([\s\S]*?)<\/p>/g)].map((match) => Number(stripTags(match[1])));
  const stats = {};

  names.forEach((name, index) => {
    const key = statKeys[name];
    const value = values[index];
    if (key && Number.isFinite(value)) {
      stats[key] = value;
    }
  });

  const total = Number(stripTags(firstMatch(html, /图标 宠物 资质 种族\.png[\s\S]*?种族值<\/p>\s*<p>([\s\S]*?)<\/p>/)));
  if (Number.isFinite(total)) stats.total = total;
  return stats;
}

function parsePhysique(html) {
  const blocks = [...html.matchAll(/<div class="rocom_sprite_info_physique">([\s\S]*?)<\/div>\s*<div class="rocom_sprite_bgcontent_box/g)].map((match) => match[1]);
  const block = blocks.at(-1) || "";
  const rows = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  const values = rows.map((row) => {
    const value = stripTags(row.match(/<\/div>\s*<p>([\s\S]*?)<\/p>/)?.[1] || "");
    const unit = stripTags(row.match(/font-runeregular">([\s\S]*?)<\/p>/)?.[1] || "");
    return [value, unit].filter(Boolean).join(" ");
  });

  return {
    height: values[0] || "",
    weight: values[1] || ""
  };
}

function parseDescription(html) {
  return lastUnique([...html.matchAll(/rocom_sprite_info_content[^>]*>([\s\S]*?)<\/div>/g)].map((match) => stripTags(match[1])));
}

function parseDistribution(html) {
  const blocks = [...html.matchAll(/rocom_sprite_bgcontent_box[^>]*>([\s\S]*?)<\/div>\s*<div class="rocom_sprite_info_content/g)].map((match) => match[1]);
  const block = blocks.at(-1) || "";
  const paragraphs = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) => stripTags(match[1]));
  return {
    location: (paragraphs.find((item) => item.startsWith("精灵分布:")) || "").replace(/^精灵分布:/, "").trim(),
    category: paragraphs.find((item) => !item.startsWith("精灵分布:")) || ""
  };
}

function parseCharacteristics(html) {
  const titles = [...html.matchAll(/rocom_sprite_info_characteristic_title[^>]*>([\s\S]*?)<\/p>/g)].map((match) => stripTags(match[1]));
  const descriptions = [...html.matchAll(/rocom_sprite_info_characteristic_text[^>]*>([\s\S]*?)<\/p>/g)].map((match) => stripTags(match[1]));
  const pairs = titles.map((name, index) => ({
    name,
    description: descriptions[index] || ""
  }));
  const deduped = new Map();
  pairs.forEach((item) => {
    if (item.name) deduped.set(item.name, item);
  });
  return [...deduped.values()];
}

function parseRestraints(html) {
  const start = html.lastIndexOf("rocom_sprite_temp_restrain_box");
  if (start === -1) return { strongAgainst: [], weakAgainst: [] };
  const end = html.indexOf("rocom_sprite_skill_box", start);
  const block = html.slice(start, end === -1 ? start + 6000 : end);
  const sections = [...block.matchAll(/<div>\s*<p>(克制|被克制)<\/p>([\s\S]*?)<\/div>/g)];
  const result = { strongAgainst: [], weakAgainst: [] };

  sections.forEach((match) => {
    const values = unique([...match[2].matchAll(/alt="图标 宠物 属性 ([^"]+?)\.png"/g)].map((item) => decodeHtml(item[1])));
    if (match[1] === "克制") result.strongAgainst = values;
    if (match[1] === "被克制") result.weakAgainst = values;
  });

  return result;
}

function parseEvolution(html) {
  const start = html.lastIndexOf("rocom_spirit_evolution_box");
  if (start === -1) return { chain: [], levels: [] };
  const end = html.indexOf("rocom_sprite_temp_restrain_box", start);
  const block = html.slice(start, end === -1 ? start + 5000 : end);
  const chain = [...block.matchAll(/<a href="([^"]+)" title="([^"]+)">[\s\S]*?<img[^>]+src="([^"]+)"/g)].map((match) => ({
    name: decodeHtml(match[2]),
    wikiUrl: absoluteWikiUrl(match[1]),
    thumbnailUrl: absoluteWikiUrl(match[3]),
    imageUrl: cleanImageUrl(match[3])
  }));
  const levels = unique([...block.matchAll(/rocom_spirit_evolution_level_num[^>]*>([\s\S]*?)<\/p>/g)].map((match) => stripTags(match[1])));
  return { chain, levels };
}

function blocksByClass(html, className) {
  return html
    .split(new RegExp(`<div class="${className}"`))
    .slice(1)
    .map((chunk) => `<div class="${className}"${chunk.split(new RegExp(`<div class="${className}"`))[0]}`);
}

function parseSkills(html) {
  const skills = blocksByClass(html, "rocom_sprite_skill_box").map((block) => {
    const link = block.match(/<a href="([^"]+)" title="([^"]+)">/);
    const type = decodeHtml(block.match(/alt="图标 宠物 属性 ([^"]+?)\.png"/)?.[1] || "");
    return {
      level: stripTags(firstMatch(block, /rocom_sprite_skill_level[^>]*>([\s\S]*?)<\/div>/)),
      name: stripTags(firstMatch(block, /rocom_sprite_skillName[^>]*>([\s\S]*?)<\/div>/)) || decodeHtml(link?.[2] || ""),
      attribute: type,
      category: stripTags(firstMatch(block, /rocom_sprite_skillType[^>]*>([\s\S]*?)<\/div>/)),
      damage: stripTags(firstMatch(block, /rocom_sprite_skillDamage[^>]*>([\s\S]*?)<\/div>/)),
      power: stripTags(firstMatch(block, /rocom_sprite_skill_power[^>]*>([\s\S]*?)<\/div>/)),
      description: stripTags(firstMatch(block, /rocom_sprite_skillContent[^>]*>([\s\S]*?)<\/div>/)),
      wikiUrl: absoluteWikiUrl(link?.[1] || "")
    };
  });

  const seen = new Set();
  return skills.filter((skill) => {
    if (!skill.name) return false;
    const key = [skill.level, skill.name, skill.description].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDetail(spirit, html) {
  return {
    number: spirit.number,
    name: spirit.name,
    wikiTitle: spirit.wikiTitle,
    wikiUrl: spirit.wikiUrl,
    sourceUrl: spirit.wikiUrl,
    stats: parseStats(html),
    physique: parsePhysique(html),
    distribution: parseDistribution(html),
    description: parseDescription(html),
    characteristics: parseCharacteristics(html),
    evolution: parseEvolution(html),
    restraints: parseRestraints(html),
    skills: parseSkills(html)
  };
}

function existingDetailsByUrl() {
  if (!fs.existsSync(outputJson)) return new Map();
  try {
    const file = JSON.parse(fs.readFileSync(outputJson, "utf8"));
    return new Map((file.details || []).map((detail) => [detail.wikiUrl, detail]));
  } catch {
    return new Map();
  }
}

async function main() {
  if (!fs.existsSync(dexPath)) {
    throw new Error("Missing data/biligame-spirit-dex.json. Run npm run build:data first.");
  }

  const dexFile = JSON.parse(fs.readFileSync(dexPath, "utf8"));
  const spirits = sampleNames.length
    ? dexFile.spirits.filter((spirit) => sampleNames.includes(spirit.name) || sampleNames.includes(spirit.wikiTitle))
    : dexFile.spirits;
  const details = [];
  const errors = [];
  const existing = existingDetailsByUrl();

  for (const [index, spirit] of spirits.entries()) {
    try {
      const htmlPath = path.join(rawRoot, safeFilename(spirit));
      const existingDetail = existing.get(spirit.wikiUrl);
      if (existingDetail && fs.existsSync(htmlPath)) {
        details.push(existingDetail);
      } else {
        const html = await fetchHtml(spirit);
        details.push(parseDetail(spirit, html));
      }
      if ((index + 1) % 25 === 0 || index === spirits.length - 1) {
        console.log(`Imported ${index + 1}/${spirits.length} details`);
      }
    } catch (error) {
      errors.push({
        number: spirit.number,
        name: spirit.name,
        wikiUrl: spirit.wikiUrl,
        error: error.message
      });
      console.warn(`Failed ${spirit.name}: ${error.message}`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "BWIKI 洛克王国世界 精灵详情页",
      url: sourceRoot,
      license: "CC BY-NC-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans"
    },
    total: details.length,
    errors,
    details
  };

  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(outputJson, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Imported ${details.length} Biligame spirit detail pages`);
  if (errors.length) console.log(`Errors: ${errors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
