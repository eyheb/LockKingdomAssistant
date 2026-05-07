import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCommunityStore } from "./community-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const dataRoot = path.join(projectRoot, "data");

function readJson(filename, fallback) {
  const filePath = path.join(dataRoot, filename);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeCommunityEntries(file) {
  return (file.entries || []).map((entry) => ({
    ...entry,
    id: entry.id || "",
    player: entry.player || entry.ownerName || entry.owner || "",
    spirit: entry.spirit || "",
    gender: entry.gender || "",
    nature: entry.nature || "",
    note: entry.note || "",
    eggGroups: Array.isArray(entry.eggGroups) ? entry.eggGroups : [],
    stats: entry.stats || {}
  }));
}

export function loadData() {
  const spiritFile = readJson("spirits.json", { spirits: [] });
  const eggGroupFile = readJson("egg-groups.json", { groups: [] });
  const exchangeFile = readJson("exchange.json", { entries: [] });
  const biligameDexFile = readJson("biligame-spirit-dex.json", { spirits: [], source: null });
  const biligameDetailsFile = readJson("biligame-spirit-details.json", { details: [], source: null });
  const communityExchangeFile = readJson("community-exchange.json", null);
  const communityExchange = normalizeCommunityEntries(communityExchangeFile || { entries: [] });

  return {
    spirits: spiritFile.spirits,
    groups: eggGroupFile.groups,
    exchange: communityExchangeFile ? communityExchange : exchangeFile.entries,
    communityExchange,
    biligameDex: biligameDexFile.spirits,
    biligameDetails: biligameDetailsFile.details,
    sources: {
      biligameDex: biligameDexFile.source,
      biligameDetails: biligameDetailsFile.source
    }
  };
}

export async function loadDataAsync() {
  const data = loadData();
  try {
    const communityStore = await readCommunityStore();
    const communityExchange = normalizeCommunityEntries(communityStore);
    return {
      ...data,
      exchange: communityExchange,
      communityExchange
    };
  } catch {
    return data;
  }
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

function includesSignificant(fields, query, minContainedLength = 2) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;
  return fields.some((field) => {
    const normalizedField = normalize(field);
    if (!normalizedField) return false;
    return normalizedField.includes(normalizedQuery) || (normalizedField.length >= minContainedLength && normalizedQuery.includes(normalizedField));
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

const spiritTypes = ["普通", "草", "火", "水", "光", "地", "冰", "龙", "电", "毒", "幽", "武", "翼", "萌", "幻", "恶", "机械", "虫"];

function parseNumber(value) {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function isTypeQuery(query, type) {
  const compact = String(query || "").replace(/\s+/g, "");
  return compact === type || compact.includes(`${type}系`) || compact.includes(`${type}属性`) || compact.includes(`${type}精灵`);
}

function stripTrailingPunctuation(value) {
  return String(value || "").trim().replace(/[。！？.!?]+$/u, "");
}

function baseNatureName(value) {
  return String(value || "").split(/[（(]/)[0].trim();
}

function queryContainsValue(query, value, minLength = 2) {
  const normalizedQuery = normalize(stripTrailingPunctuation(query));
  const normalizedValue = normalize(value);
  return Boolean(normalizedValue && normalizedValue.length >= minLength && normalizedQuery.includes(normalizedValue));
}

function detailSearchScore(detail, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  let score = 0;
  if (exactNameMatch(detail.name, query) || exactNameMatch(detail.wikiTitle, query)) score += 120;
  if (nameContainedInQuery(detail.name, query) || nameContainedInQuery(detail.wikiTitle, query)) score += 80;

  const fields = [
    detail.number,
    detail.description,
    detail.physique?.height,
    detail.physique?.weight,
    detail.distribution?.location,
    detail.distribution?.category,
    ...(detail.characteristics || []).flatMap((item) => [item.name, item.description]),
    ...(detail.evolution?.chain || []).map((item) => item.name),
    ...(detail.evolution?.levels || []),
    ...(detail.skills || []).flatMap((skill) => [
      skill.name,
      skill.category,
      skill.damage,
      skill.power,
      skill.description
    ])
  ];

  if (includesSignificant(fields, query, 2)) score += 35;
  return score;
}

function dexSearchScore(spirit, detail, query) {
  let score = 0;
  if (exactNameMatch(spirit.name, query) || exactNameMatch(spirit.wikiTitle, query)) score += 140;
  if (nameContainedInQuery(spirit.name, query) || nameContainedInQuery(spirit.wikiTitle, query)) score += 90;
  if (includesSignificant([spirit.number, spirit.stage, spirit.form, ...spirit.specialForms], query, 2)) score += 25;
  if ((spirit.types || []).some((type) => isTypeQuery(query, type))) score += 25;
  if (detail) score += detailSearchScore(detail, query);
  return score;
}

function buildSkillIndex(biligameDetails = []) {
  return biligameDetails.flatMap((detail) =>
    (detail.skills || []).map((skill, index) => ({
      id: `${detail.wikiUrl || detail.name || "unknown"}#skill-${index}`,
      name: skill.name || "",
      attribute: skill.attribute || "",
      category: skill.category || "",
      damage: skill.damage || "",
      power: skill.power || "",
      powerValue: parseNumber(skill.power),
      level: String(skill.level || "").trim(),
      description: skill.description || "",
      wikiUrl: skill.wikiUrl || "",
      ownerName: detail.name || "",
      ownerNumber: detail.number || "",
      ownerWikiUrl: detail.wikiUrl || ""
    }))
  );
}

function getTotals(data, skillIndex) {
  return {
    spirits: data.spirits.length,
    dex: data.biligameDex.length,
    details: data.biligameDetails.length,
    skills: skillIndex.length,
    groups: data.groups.length,
    exchange: data.exchange.length
  };
}

function mergeUniqueBy(items, keyFn) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function extractSkillAttribute(query) {
  const compact = String(query || "").replace(/\s+/g, "");
  return spiritTypes
    .slice()
    .sort((a, b) => b.length - a.length)
    .find((type) =>
      compact.includes(`${type}系`) ||
      compact.includes(`${type}属性`) ||
      compact.includes(`${type}技能`)
    ) || "";
}

function extractSkillCategory(query) {
  const compact = String(query || "").replace(/\s+/g, "");
  if (/物攻|物理/.test(compact)) return "物攻";
  if (/魔攻|魔法/.test(compact)) return "魔攻";
  if (/状态/.test(compact)) return "状态";
  if (/防御/.test(compact)) return "防御";
  return "";
}

function isSkillFocusedQuery(skillIndex, query) {
  const compact = String(query || "").replace(/\s+/g, "");
  if (/技能|威力|伤害|能耗|物攻|物理|魔攻|魔法|状态|防御|谁会|掌握|学习/.test(compact)) return true;
  return skillIndex.some((skill) => skill.name.length >= 2 && compact.includes(skill.name));
}

function isHighestPowerQuestion(query) {
  const compact = String(query || "").replace(/\s+/g, "");
  return /技能/.test(compact) && /(威力最高|最高威力|威力最大|最大威力|最强|哪个.*威力|什么.*威力)/.test(compact);
}

function groupSkillRows(skillRows) {
  const grouped = new Map();
  for (const skill of skillRows) {
    const key = [skill.name, skill.attribute, skill.category, skill.powerValue ?? "", skill.description].join("\u0001");
    const current = grouped.get(key);
    if (current) {
      if (skill.ownerName && !current.owners.includes(skill.ownerName)) {
        current.owners.push(skill.ownerName);
      }
      current.ownerCount += 1;
      continue;
    }
    grouped.set(key, {
      ...skill,
      owners: skill.ownerName ? [skill.ownerName] : [],
      ownerCount: 1
    });
  }
  return [...grouped.values()];
}

function buildSkillPowerInsight(skillIndex, query, limit) {
  if (!isHighestPowerQuestion(query)) return null;
  const attribute = extractSkillAttribute(query);
  const category = extractSkillCategory(query);
  const candidates = skillIndex.filter((skill) => {
    if (!skill.powerValue || skill.powerValue <= 0) return false;
    if (attribute && skill.attribute !== attribute) return false;
    if (category && skill.category !== category) return false;
    return true;
  });
  if (!candidates.length) return null;

  const grouped = groupSkillRows(candidates).sort(
    (a, b) =>
      (b.powerValue || 0) - (a.powerValue || 0) ||
      a.name.localeCompare(b.name, "zh-Hans-CN") ||
      a.attribute.localeCompare(b.attribute, "zh-Hans-CN")
  );
  const maxPower = grouped[0]?.powerValue || 0;

  return {
    kind: "skillPowerMax",
    attribute,
    category,
    maxPower,
    totalCandidates: candidates.length,
    topSkills: grouped.filter((skill) => skill.powerValue === maxPower).slice(0, Math.max(1, Math.min(limit, 8))),
    candidates: grouped.slice(0, limit)
  };
}

function skillSearchScore(skill, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const name = normalize(skill.name);
  const ownerName = normalize(skill.ownerName);
  const attribute = normalize(skill.attribute);
  const category = normalize(skill.category);
  const description = normalize(skill.description);
  let score = 0;
  if (name && name === normalizedQuery) score += 120;
  if (ownerName && ownerName === normalizedQuery) score += 100;
  if (name && normalizedQuery.includes(name)) score += 70;
  if (ownerName && normalizedQuery.includes(ownerName)) score += 55;
  if (attribute && (normalizedQuery.includes(`${attribute}系`) || normalizedQuery.includes(`${attribute}属性`) || normalizedQuery.includes(attribute))) score += 30;
  if (category && normalizedQuery.includes(category)) score += 18;
  if (description && description.includes(normalizedQuery)) score += 12;
  if (String(skill.power || "") && normalizedQuery.includes(String(skill.power))) score += 8;
  return score + (skill.powerValue || 0) / 1000;
}

function exchangeSearchScore(entry, query) {
  let score = 0;
  if (exactNameMatch(entry.player, query) || exactNameMatch(entry.spirit, query)) score += 120;
  if (nameContainedInQuery(entry.player, query) || nameContainedInQuery(entry.spirit, query)) score += 80;
  if (queryContainsValue(query, baseNatureName(entry.nature))) score += 90;
  if (queryContainsValue(query, entry.gender, 1)) score += 25;
  if (includesSignificant([entry.id, entry.nature, entry.note, ...Object.values(entry.stats || {})], query, 2)) score += 35;
  if ((entry.eggGroups || []).some((group) => queryContainsValue(query, group) || normalize(group).includes(normalize(stripTrailingPunctuation(query))))) score += 70;
  return score;
}

function searchSkills(skillIndex, query, limit, skillPowerInsight) {
  if (skillPowerInsight?.candidates?.length) {
    return skillPowerInsight.candidates.slice(0, limit);
  }

  if (!isSkillFocusedQuery(skillIndex, query)) {
    return [];
  }

  return skillIndex
    .map((skill) => ({ skill, score: skillSearchScore(skill, query) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.skill.powerValue || 0) - (a.skill.powerValue || 0) ||
        a.skill.name.localeCompare(b.skill.name, "zh-Hans-CN")
    )
    .slice(0, limit)
    .map(({ skill }) => skill);
}

function decorateDexMatch(spirit, detailsByUrl) {
  return {
    ...spirit,
    detail: detailsByUrl.get(spirit.wikiUrl) || null
  };
}

function dexFromDetail(detail, dexByUrl) {
  const dex = dexByUrl.get(detail.wikiUrl);
  if (dex) return dex;
  return {
    number: detail.number || "",
    name: detail.name || detail.wikiTitle || "",
    wikiTitle: detail.wikiTitle || detail.name || "",
    stage: "",
    types: [],
    secondaryType: "",
    form: "",
    specialForms: [],
    hasShiny: false,
    wikiUrl: detail.wikiUrl || "",
    imageUrl: "",
    thumbnailUrl: ""
  };
}

function statSummary(stats = {}) {
  const labels = [
    ["hp", "生命"],
    ["physicalAttack", "物攻"],
    ["magicAttack", "魔攻"],
    ["physicalDefense", "物防"],
    ["magicDefense", "魔防"],
    ["speed", "速度"],
    ["total", "总和"]
  ];
  return labels
    .filter(([key]) => stats[key] !== undefined && stats[key] !== "")
    .map(([key, label]) => `${label}${stats[key]}`)
    .join(" / ");
}

function formatSkillOwnerText(skill, ownerLimit = 8) {
  const owners = skill.owners || (skill.ownerName ? [skill.ownerName] : []);
  if (!owners.length) return "";
  const hidden = Math.max(0, (skill.ownerCount || owners.length) - ownerLimit);
  return `掌握精灵：${owners.slice(0, ownerLimit).join("、")}${hidden ? `等 ${skill.ownerCount} 条记录` : ""}`;
}

function formatSkillLine(skill) {
  return `${skill.name}（${[skill.attribute, skill.category, skill.powerValue ? `威力${skill.powerValue}` : "", skill.level].filter(Boolean).join("，")}）${formatSkillOwnerText(skill) ? `，${formatSkillOwnerText(skill)}` : ""}${skill.description ? `，效果：${skill.description}` : ""}`;
}

function formatSkillPowerAnswer(insight) {
  const scope = [insight.attribute ? `${insight.attribute}系` : "全属性", insight.category].filter(Boolean).join("、");
  const top = insight.topSkills.map((skill) => formatSkillLine(skill)).join("；");
  return `${scope}威力最高的技能是：${top}。按本地技能表的 power 数值计算，最高威力为 ${insight.maxPower}。`;
}

export function searchKnowledge(query, limit = 12) {
  return searchKnowledgeInData(loadData(), query, limit);
}

export async function searchKnowledgeAsync(query, limit = 12) {
  return searchKnowledgeInData(await loadDataAsync(), query, limit);
}

function searchKnowledgeInData(data, query, limit = 12) {
  const { spirits, groups, exchange, biligameDex, biligameDetails } = data;
  const cleanQuery = String(query || "").trim();
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(Number(limit), 50)) : 12;
  const skillIndex = buildSkillIndex(biligameDetails);
  const detailsByUrl = new Map(biligameDetails.map((detail) => [detail.wikiUrl, detail]));
  const dexByUrl = new Map(biligameDex.map((spirit) => [spirit.wikiUrl, spirit]));
  const totals = getTotals(data, skillIndex);
  const skillPowerInsight = buildSkillPowerInsight(skillIndex, cleanQuery, safeLimit);
  const skillFocused = isSkillFocusedQuery(skillIndex, cleanQuery);

  if (!cleanQuery) {
    return {
      query: cleanQuery,
      spirits: spirits.slice(0, safeLimit),
      dex: biligameDex.slice(0, safeLimit),
      groups: groups.slice(0, safeLimit),
      skills: skillIndex.slice(0, safeLimit),
      exchange: exchange.slice(0, safeLimit),
      insights: {},
      totals
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
    : skillFocused
      ? []
      : biligameDex.filter((spirit) => dexSearchScore(spirit, detailsByUrl.get(spirit.wikiUrl), cleanQuery) > 0);

  const detailMatches = skillFocused && !namedDexMatches.length
    ? []
    : biligameDetails
        .filter((detail) => detailSearchScore(detail, cleanQuery) > 0)
        .map((detail) => dexFromDetail(detail, dexByUrl));

  const dexMatches = mergeUniqueBy([...dexSource, ...detailMatches], (spirit) => spirit.wikiUrl || spirit.name)
    .sort((a, b) => Number(a.number) - Number(b.number) || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .slice(0, safeLimit)
    .map((spirit) => decorateDexMatch(spirit, detailsByUrl));

  const skillMatches = searchSkills(skillIndex, cleanQuery, safeLimit, skillPowerInsight);

  const exchangeMatches = exchange
    .map((entry) => ({ entry, score: exchangeSearchScore(entry, cleanQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.spirit.localeCompare(b.entry.spirit, "zh-Hans-CN"))
    .slice(0, safeLimit);

  return {
    query: cleanQuery,
    spirits: spiritMatches,
    dex: dexMatches,
    groups: groupMatches,
    skills: skillMatches,
    exchange: exchangeMatches.map(({ entry }) => entry),
    insights: {
      skillPower: skillPowerInsight
    },
    totals
  };
}

export function formatResultsForPrompt(results) {
  const lines = [
    `查询词：${results.query || "无"}`,
    "",
    "可计算结论：",
    results.insights?.skillPower ? `- ${formatSkillPowerAnswer(results.insights.skillPower)}` : "- 无",
    "",
    "精灵匹配：",
    ...results.spirits.map((item) => `- ${item.name}：${item.eggGroups.join("、") || "未知蛋组"}`),
    "",
    "图鉴匹配：",
    ...results.dex.map((item) => {
      const detail = item.detail;
      const stats = detail?.stats ? `，种族值 ${statSummary(detail.stats)}` : "";
      const physique = detail?.physique ? `，体型 ${[detail.physique.height, detail.physique.weight].filter(Boolean).join(" / ")}` : "";
      const distribution = detail?.distribution ? `，分布 ${[detail.distribution.location, detail.distribution.category].filter(Boolean).join(" / ")}` : "";
      const characteristic = detail?.characteristics?.length
        ? `，特性 ${detail.characteristics.slice(0, 3).map((characteristicItem) => `${characteristicItem.name}：${characteristicItem.description}`).join("；")}`
        : "";
      const restraints = detail?.restraints ? `，克制 ${detail.restraints.strongAgainst?.join("、") || "未知"}，被克制 ${detail.restraints.weakAgainst?.join("、") || "未知"}` : "";
      const skills = detail?.skills?.length
        ? `，技能 ${detail.skills.slice(0, 14).map((skill) => `${skill.name}(${skill.attribute}/${skill.category}/威力${skill.power})`).join("、")}`
        : "";
      return `- NO.${item.number} ${item.name}：${item.types.join("、") || "未知属性"}，${item.stage || "未知阶段"}，${item.form || "未知形态"}${stats}${physique}${distribution}${characteristic}${restraints}${skills}${detail?.description ? `，描述 ${detail.description}` : ""}${item.wikiUrl ? `，页面 ${item.wikiUrl}` : ""}`;
    }),
    "",
    "蛋组匹配：",
    ...results.groups.map((item) => `- ${item.name}：${item.spirits.slice(0, 20).join("、")}`),
    "",
    "技能匹配：",
    ...(results.skills || []).map((item) => `- ${formatSkillLine(item)}`),
    "",
    "交换记录：",
    ...results.exchange.map((item) => {
      const stats = Object.entries(item.stats || {})
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${value}`)
        .join("，");
      return `- ${item.player || item.id}：${item.spirit}，${item.gender || "性别未知"}，蛋组 ${item.eggGroups.join("、") || "未知"}，性格 ${item.nature || "未知"}${stats ? `，资质 ${stats}` : ""}${item.note ? `，备注 ${item.note}` : ""}`;
    })
  ];

  return lines.join("\n");
}

export function localFallbackAnswer(question) {
  const results = searchKnowledge(question, 8);
  return localFallbackAnswerFromResults(results);
}

export async function localFallbackAnswerAsync(question) {
  return localFallbackAnswerFromResults(await searchKnowledgeAsync(question, 8));
}

function localFallbackAnswerFromResults(results) {
  const parts = [];

  if (results.insights?.skillPower) {
    parts.push(formatSkillPowerAnswer(results.insights.skillPower));
  }

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
          const stats = detail?.stats ? `，种族值${statSummary(detail.stats)}` : "";
          const distribution = detail?.distribution ? `，分布${[detail.distribution.location, detail.distribution.category].filter(Boolean).join(" / ")}` : "";
          const characteristic = detail?.characteristics?.[0]?.name ? `，特性${detail.characteristics[0].name}：${detail.characteristics[0].description || ""}` : "";
          const restraints = detail?.restraints ? `，克制${detail.restraints.strongAgainst?.join("、") || "未知"}，被克制${detail.restraints.weakAgainst?.join("、") || "未知"}` : "";
          const skills = detail?.skills?.length ? `，技能：${detail.skills.slice(0, 10).map((skill) => `${skill.name}(${skill.attribute}/${skill.category}/威力${skill.power})`).join("、")}` : "";
          return `NO.${item.number} ${item.name}（${item.types.join("、") || "未知属性"}，${item.stage || "未知阶段"}，${item.form || "未知形态"}${stats}${distribution}${characteristic}${restraints}${skills}）`;
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

  if (results.skills?.length && !results.insights?.skillPower) {
    parts.push(
      `技能资料：${results.skills
        .slice(0, 8)
        .map((item) => formatSkillLine(item))
        .join("；")}`
    );
  }

  if (results.exchange.length) {
    parts.push(
      `交换记录：${results.exchange
        .map((item) => `${item.player || item.id} 有 ${item.spirit}${item.gender ? `（${item.gender}）` : ""}${item.nature ? `，${item.nature}` : ""}`)
        .join("；")}`
    );
  }

  if (!parts.length) {
    return "我暂时没有在本地资料里匹配到结果。可以换个精灵名、蛋组名、性格或朋友名称再查。";
  }

  return `${parts.join("\n\n")}\n\n我先按本地资料做摘要。`;
}
