import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const dataRoot = path.join(projectRoot, "data");

function readJson(filename, fallback) {
  const filePath = path.join(dataRoot, filename);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadData() {
  const spiritFile = readJson("spirits.json", { spirits: [] });
  const eggGroupFile = readJson("egg-groups.json", { groups: [] });
  const exchangeFile = readJson("exchange.json", { entries: [] });
  const biligameDexFile = readJson("biligame-spirit-dex.json", { spirits: [], source: null });
  const biligameDetailsFile = readJson("biligame-spirit-details.json", { details: [], source: null });

  return {
    spirits: spiritFile.spirits,
    groups: eggGroupFile.groups,
    exchange: exchangeFile.entries,
    biligameDex: biligameDexFile.spirits,
    biligameDetails: biligameDetailsFile.details,
    sources: {
      biligameDex: biligameDexFile.source,
      biligameDetails: biligameDetailsFile.source
    }
  };
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function includesAny(fields, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  return fields.some((field) => {
    const normalizedField = normalize(field);
    if (!normalizedField) return false;
    return normalizedField.includes(normalizedQuery) || normalizedQuery.includes(normalizedField);
  });
}

function exactNameMatch(value, query) {
  return normalize(value) === normalize(query);
}

function nameContainedInQuery(value, query) {
  const normalizedValue = normalize(value);
  const normalizedQuery = normalize(query);
  return normalizedValue.length >= 2 && normalizedQuery.includes(normalizedValue);
}

function sortByName(a, b) {
  return (a.name || a.spirit || "").localeCompare(b.name || b.spirit || "", "zh-Hans-CN");
}

export function searchKnowledge(query, limit = 12) {
  const { spirits, groups, exchange, biligameDex, biligameDetails } = loadData();
  const cleanQuery = String(query || "").trim();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 50)) : 12;
  const detailsByUrl = new Map(biligameDetails.map((detail) => [detail.wikiUrl, detail]));

  if (!cleanQuery) {
    return {
      query: cleanQuery,
      spirits: spirits.slice(0, safeLimit),
      dex: biligameDex.slice(0, safeLimit),
      groups: groups.slice(0, safeLimit),
      exchange: exchange.slice(0, safeLimit),
      totals: {
        spirits: spirits.length,
        dex: biligameDex.length,
        details: biligameDetails.length,
        groups: groups.length,
        exchange: exchange.length
      }
    };
  }

  const spiritMatches = spirits
    .filter((spirit) => includesAny([spirit.name, ...spirit.eggGroups], cleanQuery))
    .sort(sortByName)
    .slice(0, safeLimit);

  const groupMatches = groups
    .filter((group) => includesAny([group.name, ...group.spirits], cleanQuery))
    .sort(sortByName)
    .slice(0, safeLimit);

  const namedDexMatches = biligameDex.filter(
    (spirit) =>
      exactNameMatch(spirit.name, cleanQuery) ||
      exactNameMatch(spirit.wikiTitle, cleanQuery) ||
      nameContainedInQuery(spirit.name, cleanQuery) ||
      nameContainedInQuery(spirit.wikiTitle, cleanQuery)
  );
  const dexSource = namedDexMatches.length
    ? namedDexMatches
    : biligameDex.filter((spirit) =>
        includesAny(
          [
            spirit.number,
            spirit.name,
            spirit.wikiTitle,
            spirit.stage,
            spirit.form,
            ...spirit.types,
            ...spirit.specialForms
          ],
          cleanQuery
        )
      );
  const dexMatches = dexSource
    .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .slice(0, safeLimit)
    .map((spirit) => ({
      ...spirit,
      detail: detailsByUrl.get(spirit.wikiUrl) || null
    }));

  const exchangeMatches = exchange
    .filter((entry) =>
      includesAny(
        [
          entry.id,
          entry.spirit,
          entry.gender,
          entry.nature,
          entry.note,
          ...entry.eggGroups,
          ...Object.values(entry.stats || {})
        ],
        cleanQuery
      )
    )
    .sort((a, b) => a.spirit.localeCompare(b.spirit, "zh-Hans-CN"))
    .slice(0, safeLimit);

  return {
    query: cleanQuery,
    spirits: spiritMatches,
    dex: dexMatches,
    groups: groupMatches,
    exchange: exchangeMatches,
    totals: {
      spirits: spirits.length,
      dex: biligameDex.length,
      details: biligameDetails.length,
      groups: groups.length,
      exchange: exchange.length
    }
  };
}

export function formatResultsForPrompt(results) {
  const lines = [
    `查询词：${results.query || "无"}`,
    "",
    "精灵匹配：",
    ...results.spirits.map((item) => `- ${item.name}：${item.eggGroups.join("、") || "未知蛋组"}`),
    "",
    "图鉴匹配：",
    ...results.dex.map((item) => {
      const detail = item.detail;
      const stats = detail?.stats?.total ? `，种族值 ${detail.stats.total}` : "";
      const characteristic = detail?.characteristics?.[0]?.name ? `，特性 ${detail.characteristics[0].name}` : "";
      const skills = detail?.skills?.length ? `，技能 ${detail.skills.slice(0, 8).map((skill) => skill.name).join("、")}` : "";
      return `- NO.${item.number} ${item.name}：${item.types.join("、") || "未知属性"}，${item.stage || "未知阶段"}，${item.form || "未知形态"}${stats}${characteristic}${skills}${item.wikiUrl ? `，页面 ${item.wikiUrl}` : ""}`;
    }),
    "",
    "蛋组匹配：",
    ...results.groups.map((item) => `- ${item.name}：${item.spirits.slice(0, 20).join("、")}`),
    "",
    "交换记录：",
    ...results.exchange.map((item) => {
      const stats = Object.entries(item.stats || {})
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join("，");
      return `- ${item.id}：${item.spirit}，${item.gender || "性别未知"}，蛋组 ${item.eggGroups.join("、") || "未知"}，性格 ${item.nature || "未知"}${stats ? `，资质 ${stats}` : ""}${item.note ? `，备注 ${item.note}` : ""}`;
    })
  ];

  return lines.join("\n");
}

export function localFallbackAnswer(question) {
  const results = searchKnowledge(question, 8);
  const parts = [];

  if (results.spirits.length) {
    parts.push(
      `精灵资料：${results.spirits
        .map((item) => `${item.name}（${item.eggGroups.join("、") || "未知蛋组"}）`)
        .join("；")}`
    );
  }

  if (results.dex.length) {
    parts.push(
      `图鉴资料：${results.dex
        .map((item) => {
          const detail = item.detail;
          const stats = detail?.stats?.total ? `，种族值${detail.stats.total}` : "";
          const characteristic = detail?.characteristics?.[0]?.name ? `，特性${detail.characteristics[0].name}` : "";
          const skills = detail?.skills?.length ? `，技能：${detail.skills.slice(0, 6).map((skill) => skill.name).join("、")}` : "";
          return `NO.${item.number} ${item.name}（${item.types.join("、") || "未知属性"}，${item.stage || "未知阶段"}，${item.form || "未知形态"}${stats}${characteristic}${skills}）`;
        })
        .join("；")}`
    );
  }

  if (results.groups.length) {
    parts.push(
      `相关蛋组：${results.groups
        .map((item) => `${item.name}包含 ${item.spirits.slice(0, 8).join("、")}`)
        .join("；")}`
    );
  }

  if (results.exchange.length) {
    parts.push(
      `交换记录：${results.exchange
        .map((item) => `${item.id} 有 ${item.spirit}${item.gender ? `（${item.gender}）` : ""}${item.nature ? `，${item.nature}` : ""}`)
        .join("；")}`
    );
  }

  if (!parts.length) {
    return "我暂时没有在本地资料里匹配到结果。可以换个精灵名、蛋组名、性格或朋友名称再查。";
  }

  return `${parts.join("\n\n")}\n\n我先按本地资料做摘要。`;
}
