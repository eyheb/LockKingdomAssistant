const starters = ["地系什么技能威力最高？", "迪莫的种族值和技能有哪些？", "龙组有哪些可以交换的精灵？", "固执性格的交换记录有哪些？"];
const stageOrder = ["Ⅰ阶", "Ⅱ阶", "最终形态"];
const typeOrder = ["普通", "草", "火", "水", "光", "地", "冰", "龙", "电", "毒", "幽", "武", "翼", "萌", "幻", "恶", "机械", "虫"];
const specialOptions = [
  { value: "地区形态", label: "地区形态" },
  { value: "首领形态", label: "首领形态" }
];
const shinyOptions = [
  { value: "yes", label: "有异色" },
  { value: "no", label: "没异色" }
];
const viewTitles = {
  assistant: "助手问答",
  spirits: "精灵资料",
  groups: "蛋组浏览",
  exchange: "交换记录",
  detail: "精灵详情"
};

const state = {
  activeView: "assistant",
  data: { spirits: [], groups: [], exchange: [], biligameDex: [], biligameDetails: [] },
  latestResults: { spirits: [], dex: [], groups: [], exchange: [], skills: [], insights: {}, totals: { spirits: 0, dex: 0, details: 0, groups: 0, exchange: 0, skills: 0 } },
  messages: [
    {
      role: "assistant",
      content: "资料已就绪。"
    }
  ],
  chatting: false,
  dexFilters: {
    query: "",
    stages: new Set(),
    types: new Set(),
    specials: new Set(),
    shiny: "",
    eggGroup: "",
    sort: "number"
  },
  selectedSpiritUrl: ""
  ,
  community: { users: [], entries: [], updatedAt: "" },
  communityFilter: "",
  exchangeFilters: {},
  exchangeSort: { field: "player", direction: "asc" }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  lookup: $("#lookup"),
  password: $("#password"),
  chatInput: $("#chatInput"),
  chatForm: $("#chatForm"),
  sendBtn: $("#sendBtn"),
  messages: $("#messages"),
  status: $("#status"),
  quickList: $("#quickList"),
  resultMeta: $("#resultMeta"),
  spirits: $("#spirits"),
  groups: $("#groups"),
  skills: $("#skills"),
  exchange: $("#exchange"),
  viewTitle: $("#viewTitle"),
  spiritSearch: $("#spiritSearch"),
  dexEggGroup: $("#dexEggGroup"),
  dexSort: $("#dexSort"),
  dexReset: $("#dexReset"),
  dexStageFilters: $("#dexStageFilters"),
  dexSpecialFilters: $("#dexSpecialFilters"),
  dexShinyFilters: $("#dexShinyFilters"),
  dexTypeFilters: $("#dexTypeFilters"),
  dexResultCount: $("#dexResultCount"),
  dexActiveFilters: $("#dexActiveFilters"),
  dexGrid: $("#dexGrid"),
  detailView: $("#detailView"),
  detailContent: $("#detailContent"),
  groupGrid: $("#groupGrid"),
  exchangeFilter: $("#exchangeFilter"),
  exchangeAddRow: $("#exchangeAddRow"),
  exchangeSaveAll: $("#exchangeSaveAll"),
  exchangeRefresh: $("#exchangeRefresh"),
  exchangeClearFilters: $("#exchangeClearFilters"),
  exchangeTableBody: $("#exchangeTableBody"),
  spiritNameList: $("#spiritNameList"),
  natureList: $("#natureList"),
  spiritCount: $("#spiritCount"),
  groupCount: $("#groupCount"),
  exchangeCount: $("#exchangeCount"),
  assistantMeta: $("#assistantMeta"),
  spiritMeta: $("#spiritMeta"),
  groupMeta: $("#groupMeta"),
  exchangeMeta: $("#exchangeMeta"),
  modelStatus: $("#modelStatus")
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tagsHtml(tags) {
  if (!tags?.length) return "";
  return `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function splitList(value) {
  return String(value || "")
    .split(/[,\s，、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function statText(stats = {}) {
  return [
    stats.hp ? `生${stats.hp}` : "",
    stats.attack ? `物${stats.attack}` : "",
    stats.magicAttack ? `魔${stats.magicAttack}` : "",
    stats.defense ? `物防${stats.defense}` : "",
    stats.magicDefense ? `魔防${stats.magicDefense}` : "",
    stats.speed ? `速${stats.speed}` : ""
  ].filter(Boolean).join(" / ");
}

function countSkillEntries(details = []) {
  return details.reduce((sum, detail) => sum + (detail.skills?.length || 0), 0);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function numericValue(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function compareByDefinedOrder(a, b, order) {
  const aIndex = order.indexOf(a);
  const bIndex = order.indexOf(b);
  if (aIndex === -1 && bIndex === -1) return String(a || "").localeCompare(String(b || ""), "zh-Hans-CN");
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

function typeBadgeHtml(type) {
  return `<span class="type-badge" data-type="${escapeHtml(type)}">${escapeHtml(type)}</span>`;
}

function resultCard(title, body, tags = []) {
  return `
    <article class="result-card">
      <strong>${escapeHtml(title)}</strong>
      ${body ? `<p>${escapeHtml(body)}</p>` : ""}
      ${tagsHtml(tags)}
    </article>
  `;
}

function setView(view) {
  state.activeView = view;
  elements.viewTitle.textContent = viewTitles[view];
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  ["assistant", "spirits", "detail", "groups", "exchange"].forEach((name) => {
    $(`#${name}View`).classList.toggle("hidden", name !== view);
  });
}

function renderMessages() {
  elements.messages.innerHTML = state.messages
    .map((message) => {
      const label = message.role === "user" ? "我" : "洛";
      const order = message.role === "user"
        ? `<div class="bubble">${escapeHtml(message.content)}</div><div class="avatar">${label}</div>`
        : `<div class="avatar">${label}</div><div class="bubble">${escapeHtml(message.content)}</div>`;
      return `<div class="message ${message.role}">${order}</div>`;
    })
    .join("");
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderInspector(data) {
  elements.resultMeta.textContent = `资料总量：${data.totals.spirits} 蛋组精灵 / ${data.totals.dex || 0} 图鉴 / ${data.totals.details || 0} 详情 / ${data.totals.skills || 0} 技能条目 / ${data.totals.groups} 蛋组 / ${data.totals.exchange} 交换记录`;

  if (!data.query) {
    elements.spirits.innerHTML = `<p class="empty">输入关键词后显示精灵匹配</p>`;
    elements.groups.innerHTML = `<p class="empty">输入关键词后显示蛋组匹配</p>`;
    elements.skills.innerHTML = `<p class="empty">输入关键词后显示技能匹配</p>`;
    elements.exchange.innerHTML = `<p class="empty">输入关键词后显示交换记录</p>`;
    return;
  }

  elements.spirits.innerHTML = data.spirits.length
    ? data.spirits.map((item) => resultCard(item.name, "", item.eggGroups)).join("")
      + data.dex.map((item) => resultCard(`NO.${item.number} · ${item.name}`, [item.stage, item.form, item.types.join(" / ")].filter(Boolean).join(" · "), item.types)).join("")
    : data.dex.length
      ? data.dex.map((item) => resultCard(`NO.${item.number} · ${item.name}`, [item.stage, item.form, item.types.join(" / ")].filter(Boolean).join(" · "), item.types)).join("")
    : `<p class="empty">没有匹配精灵</p>`;

  elements.groups.innerHTML = data.groups.length
    ? data.groups.map((item) => resultCard(item.name, item.spirits.slice(0, 12).join("、"))).join("")
    : `<p class="empty">没有匹配蛋组</p>`;

  elements.skills.innerHTML = data.skills?.length
    ? data.skills
        .map((item) =>
          resultCard(
            item.name,
            [item.attribute, item.category, item.power ? `威力 ${item.power}` : "", item.ownerName ? `来源 ${item.ownerName}` : ""].filter(Boolean).join(" · "),
            [item.attribute, item.category].filter(Boolean)
          )
        )
        .join("")
    : `<p class="empty">没有匹配技能</p>`;

  elements.exchange.innerHTML = data.exchange.length
    ? data.exchange
        .map((item) =>
          resultCard(
            `${exchangePlayer(item) || "未填玩家"} · ${item.spirit}`,
            [item.gender, item.eggGroups.join(" / "), item.nature, item.note].filter(Boolean).join(" · ")
          )
        )
        .join("")
    : `<p class="empty">没有匹配交换记录</p>`;
}

function renderDataViews() {
  const { spirits, groups, exchange, biligameDex = [], biligameDetails = [] } = state.data;
  const skillCount = countSkillEntries(biligameDetails);
  elements.spiritCount.textContent = `${spirits.length} 蛋组精灵 / ${biligameDex.length} 图鉴`;
  elements.groupCount.textContent = `${groups.length} 蛋组`;
  elements.exchangeCount.textContent = `${exchange.length} 记录`;
  const summary = `${spirits.length} 蛋组精灵 / ${biligameDex.length} 图鉴 / ${biligameDetails.length} 详情 / ${skillCount} 技能条目 / ${groups.length} 蛋组 / ${exchange.length} 交换记录`;
  elements.assistantMeta.textContent = summary;
  elements.spiritMeta.textContent = summary;
  elements.groupMeta.textContent = summary;
  elements.exchangeMeta.textContent = summary;

  renderDexControls();
  renderDexGrid();
  renderCommunityExchange();

  elements.groupGrid.innerHTML = groups
    .map(
      (group) => `
        <article class="group-card">
          <strong>${escapeHtml(group.name)}</strong>
          <p>${escapeHtml(group.spirits.slice(0, 18).join("、"))}${group.spirits.length > 18 ? "..." : ""}</p>
          <button type="button" data-group="${escapeHtml(group.name)}">筛选这个蛋组</button>
        </article>
      `
    )
    .join("");

  elements.groupGrid.querySelectorAll("button[data-group]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.lookup.value = button.dataset.group;
      state.dexFilters.eggGroup = button.dataset.group;
      elements.dexEggGroup.value = button.dataset.group;
      renderDexGrid();
      runSearch(button.dataset.group);
      setView("spirits");
    });
  });
}

function getEggGroupsBySpirit() {
  const map = new Map();
  state.data.spirits.forEach((item) => {
    map.set(item.name, item.eggGroups || []);
  });
  return map;
}

function getExchangeBySpirit() {
  const map = new Map();
  getAllExchangeEntries().forEach((item) => {
    if (!map.has(item.spirit)) map.set(item.spirit, []);
    map.get(item.spirit).push(item);
  });
  return map;
}

function getAllExchangeEntries() {
  return state.community.entries?.length ? state.community.entries : state.data.exchange;
}

function getSpiritByName(name) {
  return (state.data.spirits || []).find((item) => item.name === name) || null;
}

async function loadCommunityExchange() {
  const response = await fetch("/api/community-exchange");
  if (!response.ok) throw new Error(`交换表读取失败：${response.status}`);
  state.community = await response.json();
  state.data.exchange = state.community.entries || [];
  renderCommunityExchange();
}

async function saveCommunity(payload) {
  const response = await fetch("/api/community-exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `交换表保存失败：${response.status}`);
  state.community = data;
  state.data.exchange = data.entries || [];
  renderDataViews();
  await runSearch(elements.lookup.value);
}

function exchangePlayer(entry) {
  const fallbackId = String(entry.id || "");
  const isInternalId = fallbackId.startsWith("entry-") || fallbackId.startsWith("legacy-");
  return entry.player || entry.ownerName || entry.owner || (isInternalId ? "" : fallbackId);
}

function exchangeFieldValue(entry, field) {
  if (field === "player") return exchangePlayer(entry);
  if (field === "eggGroups") return (entry.eggGroups || []).join("、");
  if (field.startsWith("stats.")) return entry.stats?.[field.slice(6)] || "";
  return entry[field] || "";
}

function sortExchangeEntries(entries) {
  const { field, direction } = state.exchangeSort;
  const factor = direction === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const aValue = exchangeFieldValue(a, field);
    const bValue = exchangeFieldValue(b, field);
    const aNumber = numericValue(aValue);
    const bNumber = numericValue(bValue);
    if (aNumber !== null || bNumber !== null) {
      if (aNumber === null) return 1;
      if (bNumber === null) return -1;
      return (aNumber - bNumber) * factor;
    }
    return String(aValue).localeCompare(String(bValue), "zh-Hans-CN") * factor
      || String(exchangeFieldValue(a, "spirit")).localeCompare(String(exchangeFieldValue(b, "spirit")), "zh-Hans-CN");
  });
}

function applyExchangeFilters(entries) {
  const globalQuery = normalize(state.communityFilter);
  const columnFilters = Object.entries(state.exchangeFilters).filter(([, value]) => normalize(value));
  return entries.filter((entry) => {
    if (globalQuery) {
      const searchable = [
        exchangePlayer(entry),
        entry.spirit,
        entry.gender,
        entry.nature,
        entry.level,
        entry.note,
        ...(entry.eggGroups || []),
        ...Object.values(entry.stats || {})
      ];
      if (!searchable.some((field) => normalize(field).includes(globalQuery))) return false;
    }

    return columnFilters.every(([field, value]) => normalize(exchangeFieldValue(entry, field)).includes(normalize(value)));
  });
}

function updateExchangeSortIndicators() {
  document.querySelectorAll("[data-exchange-sort]").forEach((button) => {
    const active = button.dataset.exchangeSort === state.exchangeSort.field;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? state.exchangeSort.direction : "";
  });
}

function setExchangeStatus(message) {
  elements.exchangeMeta.textContent = message;
}

function exchangeCell(value, field, id, extra = "") {
  const list = field === "spirit" ? "spiritNameList" : field === "nature" ? "natureList" : "";
  return `<input class="exchange-cell ${extra}" data-entry-id="${escapeHtml(id)}" data-field="${field}" ${list ? `list="${list}"` : ""} value="${escapeHtml(value || "")}" />`;
}

function exchangeGender(value, id) {
  const options = ["", "公", "母", "无性别"];
  return `
    <select class="exchange-cell" data-entry-id="${escapeHtml(id)}" data-field="gender">
      ${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "未知")}</option>`).join("")}
    </select>
  `;
}

function rowFromElement(row) {
  const entry = {
    id: row.dataset.entryId,
    player: "",
    spirit: "",
    gender: "",
    nature: "",
    level: "",
    eggGroups: [],
    stats: {
      hp: "",
      attack: "",
      magicAttack: "",
      defense: "",
      magicDefense: "",
      speed: ""
    },
    note: ""
  };

  row.querySelectorAll("[data-field]").forEach((field) => {
    const key = field.dataset.field;
    const value = field.value.trim();
    if (key === "eggGroups") {
      entry.eggGroups = splitList(value);
    } else if (key.startsWith("stats.")) {
      entry.stats[key.slice(6)] = value;
    } else {
      entry[key] = value;
    }
  });

  return entry;
}

function markExchangeDirty(row, dirty = true) {
  row.classList.toggle("dirty", dirty);
}

function setButtonLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.label = button.textContent;
    button.textContent = label || "处理中";
    button.disabled = true;
    button.classList.add("is-loading");
  } else {
    button.textContent = button.dataset.label || label || button.textContent;
    button.disabled = false;
    button.classList.remove("is-loading");
  }
}

async function saveExchangeRow(row) {
  const entry = rowFromElement(row);
  await saveCommunity({ action: "saveEntry", entry });
  setExchangeStatus("已保存这一行");
}

async function saveAllExchangeRows() {
  const rows = [...elements.exchangeTableBody.querySelectorAll("tr[data-entry-id]")];
  for (const row of rows) {
    const entry = rowFromElement(row);
    if (!entry.player && !entry.spirit && !entry.note) continue;
    await saveCommunity({ action: "saveEntry", entry });
  }
  setExchangeStatus("已保存当前表格");
}

function addExchangeRow() {
  const id = `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    player: "",
    spirit: "",
    gender: "",
    nature: "",
    level: "",
    eggGroups: [],
    stats: {},
    note: ""
  };
  state.community.entries = [entry, ...(state.community.entries || [])];
  state.data.exchange = state.community.entries;
  renderCommunityExchange();
  const row = elements.exchangeTableBody.querySelector(`tr[data-entry-id="${CSS.escape(id)}"]`);
  if (row) {
    row.querySelector("[data-field='player']")?.focus();
    markExchangeDirty(row);
  }
}

function populateSpiritList() {
  const names = [...new Set([
    ...(state.data.biligameDex || []).map((item) => item.name),
    ...(state.data.spirits || []).map((item) => item.name),
    ...(state.data.exchange || []).map((item) => item.spirit)
  ])]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  elements.spiritNameList.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function populateNatureList() {
  const natures = [
    "沉默（+生命 -物攻）",
    "平和（+生命 -魔攻）",
    "忧郁（+生命 -物防）",
    "粗心（+生命 -魔防）",
    "踏实（+生命 -速度）",
    "逞强（+物攻 -生命）",
    "固执（+物攻 -魔攻）",
    "大胆（+物攻 -物防）",
    "调皮（+物攻 -魔防）",
    "勇敢（+物攻 -速度）",
    "理性（+魔攻 -生命）",
    "聪明（+魔攻 -物攻）",
    "专注（+魔攻 -物防）",
    "偏执（+魔攻 -魔防）",
    "冷静（+魔攻 -速度）",
    "坦率（+物防 -生命）",
    "稳重（+物防 -物攻）",
    "天真（+物防 -魔攻）",
    "懒散（+物防 -魔防）",
    "悠闲（+物防 -速度）",
    "焦虑（+魔防 -生命）",
    "鲁莽（+魔防 -物攻）",
    "害羞（+魔防 -魔攻）",
    "温顺（+魔防 -物防）",
    "慎重（+魔防 -速度）",
    "热情（+速度 -生命）",
    "胆小（+速度 -物攻）",
    "开朗（+速度 -魔攻）",
    "急躁（+速度 -物防）",
    "莽撞（+速度 -魔防）"
  ];
  elements.natureList.innerHTML = [...new Set(natures)].map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
}

function renderCommunityExchange() {
  if (!elements.exchangeTableBody) return;
  const entries = getAllExchangeEntries();
  const filtered = sortExchangeEntries(applyExchangeFilters(entries));

  elements.exchangeCount.textContent = `${entries.length} 记录`;
  elements.exchangeMeta.textContent = `${filtered.length} / ${entries.length} 条共享记录 · 所有人都可以直接编辑`;
  updateExchangeSortIndicators();

  elements.exchangeTableBody.innerHTML = filtered.length
    ? filtered.map((entry) => `
        <tr data-entry-id="${escapeHtml(entry.id)}">
          <td>${exchangeCell(exchangePlayer(entry), "player", entry.id, "w-player")}</td>
          <td>${exchangeCell(entry.spirit, "spirit", entry.id, "w-spirit")}</td>
          <td>${exchangeGender(entry.gender || "", entry.id)}</td>
          <td>${exchangeCell(entry.nature, "nature", entry.id, "w-short")}</td>
          <td>${exchangeCell(entry.level, "level", entry.id, "w-mini")}</td>
          <td>${exchangeCell((entry.eggGroups || []).join("、"), "eggGroups", entry.id, "w-groups")}</td>
          <td>${exchangeCell(entry.stats?.hp, "stats.hp", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.stats?.attack, "stats.attack", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.stats?.magicAttack, "stats.magicAttack", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.stats?.defense, "stats.defense", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.stats?.magicDefense, "stats.magicDefense", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.stats?.speed, "stats.speed", entry.id, "w-mini")}</td>
          <td>${exchangeCell(entry.note, "note", entry.id, "w-note")}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-save-entry="${escapeHtml(entry.id)}">保存</button>
              <button type="button" data-delete-entry="${escapeHtml(entry.id)}">删除</button>
            </div>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="14"><p class="empty">没有匹配记录。</p></td></tr>`;
}

function getDetailsByUrl() {
  return new Map((state.data.biligameDetails || []).map((item) => [item.wikiUrl, item]));
}

function renderFilterButton(container, group, value, label) {
  const selected = group === "shiny"
    ? state.dexFilters.shiny === value
    : state.dexFilters[group].has(value);
  container.insertAdjacentHTML(
    "beforeend",
    `<button class="${selected ? "active" : ""}" type="button" data-filter-group="${group}" data-filter-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`
  );
}

function renderDexControls() {
  const { groups, biligameDex = [] } = state.data;
  const stages = stageOrder.filter((stage) => biligameDex.some((item) => item.stage === stage));
  const types = typeOrder.filter((type) => biligameDex.some((item) => item.types.includes(type)));
  const eggGroups = groups.map((group) => group.name).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  elements.spiritSearch.value = state.dexFilters.query;
  elements.dexSort.value = state.dexFilters.sort;
  elements.dexEggGroup.innerHTML = `<option value="">全部蛋组</option>${eggGroups.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  elements.dexEggGroup.value = state.dexFilters.eggGroup;

  elements.dexStageFilters.innerHTML = "";
  stages.forEach((stage) => renderFilterButton(elements.dexStageFilters, "stages", stage, stage));

  elements.dexSpecialFilters.innerHTML = "";
  specialOptions.forEach((option) => renderFilterButton(elements.dexSpecialFilters, "specials", option.value, option.label));

  elements.dexShinyFilters.innerHTML = "";
  shinyOptions.forEach((option) => renderFilterButton(elements.dexShinyFilters, "shiny", option.value, option.label));

  elements.dexTypeFilters.innerHTML = "";
  types.forEach((type) => renderFilterButton(elements.dexTypeFilters, "types", type, type));
}

function applyDexFilters(items) {
  const filters = state.dexFilters;
  const query = normalize(filters.query);
  const eggGroupsBySpirit = getEggGroupsBySpirit();
  const selectedStages = [...filters.stages];
  const selectedTypes = [...filters.types];
  const selectedSpecials = [...filters.specials];

  return items.filter((item) => {
    const eggGroups = eggGroupsBySpirit.get(item.name) || [];
    const searchable = [
      item.number,
      item.name,
      item.wikiTitle,
      item.stage,
      item.form,
      ...item.types,
      ...item.specialForms,
      ...eggGroups
    ].map(normalize);

    if (query && !searchable.some((field) => field.includes(query))) return false;
    if (selectedStages.length && !selectedStages.includes(item.stage)) return false;
    if (selectedTypes.length && !selectedTypes.some((type) => item.types.includes(type))) return false;
    if (selectedSpecials.length && !selectedSpecials.some((special) => item.specialForms.includes(special) || item.form === special)) return false;
    if (filters.shiny === "yes" && !item.hasShiny) return false;
    if (filters.shiny === "no" && item.hasShiny) return false;
    if (filters.eggGroup && !eggGroups.includes(filters.eggGroup)) return false;
    return true;
  });
}

function sortDexItems(items) {
  const sort = state.dexFilters.sort;
  return [...items].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-Hans-CN") || Number(a.number) - Number(b.number);
    if (sort === "stage") return compareByDefinedOrder(a.stage, b.stage, stageOrder) || Number(a.number) - Number(b.number);
    if (sort === "type") return compareByDefinedOrder(a.types[0], b.types[0], typeOrder) || Number(a.number) - Number(b.number);
    if (sort === "form") return a.form.localeCompare(b.form, "zh-Hans-CN") || Number(a.number) - Number(b.number);
    return Number(a.number) - Number(b.number) || a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function renderDexGrid() {
  const { biligameDex = [] } = state.data;
  const eggGroupsBySpirit = getEggGroupsBySpirit();
  const exchangeBySpirit = getExchangeBySpirit();
  const detailsByUrl = getDetailsByUrl();
  const filtered = sortDexItems(applyDexFilters(biligameDex));
  const active = [
    state.dexFilters.query ? `关键词：${state.dexFilters.query}` : "",
    state.dexFilters.eggGroup ? `蛋组：${state.dexFilters.eggGroup}` : "",
    ...[...state.dexFilters.stages].map((item) => `类型：${item}`),
    ...[...state.dexFilters.specials].map((item) => `形态：${item}`),
    ...[...state.dexFilters.types].map((item) => `属性：${item}`),
    state.dexFilters.shiny === "yes" ? "有异色" : "",
    state.dexFilters.shiny === "no" ? "没异色" : ""
  ].filter(Boolean);

  elements.dexResultCount.textContent = `${filtered.length} / ${biligameDex.length} 条`;
  elements.dexActiveFilters.innerHTML = active.length
    ? active.map((item) => `<span>${escapeHtml(item)}</span>`).join("")
    : `<span>全部图鉴</span>`;

  if (!filtered.length) {
    elements.dexGrid.innerHTML = `<p class="empty dex-empty">没有匹配的精灵。</p>`;
    return;
  }

  elements.dexGrid.innerHTML = filtered
    .map((item) => {
      const eggGroups = eggGroupsBySpirit.get(item.name) || [];
      const exchangeRows = exchangeBySpirit.get(item.name) || [];
      const detail = detailsByUrl.get(item.wikiUrl);
      const exchangeList = exchangeRows.map((row) => `${exchangePlayer(row) || "未填玩家"}${row.gender ? ` ${row.gender}` : ""}${row.nature ? ` ${row.nature}` : ""}`);
      const detailText = detail?.stats?.total
        ? `种族值 ${detail.stats.total}${detail.characteristics?.[0]?.name ? ` · ${detail.characteristics[0].name}` : ""}`
        : "详情待导入";
      return `
        <article class="dex-card" data-wiki-url="${escapeHtml(item.wikiUrl)}">
          <button class="dex-art" type="button" data-wiki-url="${escapeHtml(item.wikiUrl)}" aria-label="查看${escapeHtml(item.name)}详情">
            <img src="${escapeHtml(item.thumbnailUrl || item.imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />
          </button>
          <div class="dex-card-body">
            <div class="dex-card-title">
              <span>NO.${escapeHtml(item.number)}</span>
              <strong>${escapeHtml(item.name)}</strong>
            </div>
            <div class="type-row">${item.types.map(typeBadgeHtml).join("")}</div>
            <dl class="dex-facts">
              <div><dt>阶段</dt><dd>${escapeHtml(item.stage || "未知")}</dd></div>
              <div><dt>形态</dt><dd>${escapeHtml(item.form || "原始形态")}</dd></div>
              <div><dt>异色</dt><dd>${item.hasShiny ? "有" : "无"}</dd></div>
              <div><dt>蛋组</dt><dd>${eggGroups.length ? escapeHtml(eggGroups.join(" / ")) : "暂无"}</dd></div>
            </dl>
            <p class="dex-detail-line">${escapeHtml(detailText)}</p>
            ${exchangeList.length ? `<ul class="dex-exchange-list">${exchangeList.map((text) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>` : ""}
            <button class="dex-open-detail" type="button" data-wiki-url="${escapeHtml(item.wikiUrl)}">查看详情</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function statRowsHtml(stats = {}) {
  const rows = [
    ["生命", stats.hp],
    ["物攻", stats.physicalAttack],
    ["魔攻", stats.magicAttack],
    ["物防", stats.physicalDefense],
    ["魔防", stats.magicDefense],
    ["速度", stats.speed]
  ];
  return rows
    .map(([label, value]) => {
      const width = Math.max(8, Math.min(100, Number(value || 0) / 2));
      return `
        <div class="stat-row">
          <span>${label}</span>
          <div><i style="width:${width}%"></i></div>
          <strong>${value || "-"}</strong>
        </div>
      `;
    })
    .join("");
}

function renderDetailView(wikiUrl) {
  const dex = (state.data.biligameDex || []).find((item) => item.wikiUrl === wikiUrl);
  const detail = getDetailsByUrl().get(wikiUrl);
  const eggGroups = getEggGroupsBySpirit().get(dex?.name) || [];

  if (!dex) {
    window.open(wikiUrl, "_blank", "noopener,noreferrer");
    return;
  }
  state.selectedSpiritUrl = wikiUrl;
  setView("detail");

  if (!detail) {
    elements.detailContent.innerHTML = `
      <div class="detail-empty">
        <div class="detail-actions">
          <button class="link-button" id="backToDex" type="button">返回图鉴</button>
          <a class="source-button" href="${escapeHtml(dex.wikiUrl)}" target="_blank" rel="noreferrer">来源页面</a>
        </div>
        <p>这只精灵还没有导入详情数据。</p>
      </div>
    `;
    $("#backToDex").addEventListener("click", () => setView("spirits"));
    return;
  }

  elements.detailContent.innerHTML = `
    <div class="detail-hero">
      <div class="detail-actions">
        <button class="link-button" id="backToDex" type="button">返回图鉴</button>
        <a class="source-button" href="${escapeHtml(dex.wikiUrl)}" target="_blank" rel="noreferrer">来源页面</a>
      </div>
      <div class="detail-hero-main">
        <img src="${escapeHtml(dex.thumbnailUrl || dex.imageUrl)}" alt="${escapeHtml(dex.name)}" />
        <div>
          <p>NO.${escapeHtml(dex.number)}</p>
          <h2>${escapeHtml(dex.name)}</h2>
          <div class="type-row">${dex.types.map(typeBadgeHtml).join("")}</div>
          <p class="detail-summary">${escapeHtml(detail.description || "暂无简介")}</p>
        </div>
      </div>
    </div>

    <div class="detail-layout">
      <section class="detail-panel">
        <h3>基础资料</h3>
        <dl class="detail-facts">
          <div><dt>阶段</dt><dd>${escapeHtml(dex.stage || "未知")}</dd></div>
          <div><dt>形态</dt><dd>${escapeHtml(dex.form || "原始形态")}</dd></div>
          <div><dt>身高</dt><dd>${escapeHtml(detail.physique?.height || "未知")}</dd></div>
          <div><dt>体重</dt><dd>${escapeHtml(detail.physique?.weight || "未知")}</dd></div>
          <div><dt>分布</dt><dd>${escapeHtml(detail.distribution?.location || "未知")}</dd></div>
          <div><dt>分类</dt><dd>${escapeHtml(detail.distribution?.category || "未知")}</dd></div>
          <div><dt>蛋组</dt><dd>${eggGroups.length ? escapeHtml(eggGroups.join(" / ")) : "暂无"}</dd></div>
        </dl>
      </section>

      <section class="detail-panel">
        <h3>种族值 ${detail.stats?.total ? `<span>${detail.stats.total}</span>` : ""}</h3>
        <div class="stat-list">${statRowsHtml(detail.stats)}</div>
      </section>

      <section class="detail-panel">
        <h3>特性</h3>
        <div class="ability-list">
          ${detail.characteristics?.length
            ? detail.characteristics.map((item) => `<article><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.description)}</p></article>`).join("")
            : `<p class="empty">暂无特性资料。</p>`}
        </div>
      </section>

      <section class="detail-panel">
        <h3>进化链</h3>
        <div class="evolution-list">
          ${detail.evolution?.chain?.length
            ? detail.evolution.chain.map((item, index) => `
                <button type="button" data-wiki-url="${escapeHtml(item.wikiUrl)}">
                  <img src="${escapeHtml(item.thumbnailUrl || item.imageUrl)}" alt="${escapeHtml(item.name)}" />
                  <span>${escapeHtml(item.name)}</span>
                  ${detail.evolution.levels?.[index - 1] ? `<small>Lv.${escapeHtml(detail.evolution.levels[index - 1])}</small>` : ""}
                </button>
              `).join("")
            : `<p class="empty">暂无进化链资料。</p>`}
        </div>
      </section>

      <section class="detail-panel">
        <h3>克制关系</h3>
        <dl class="detail-facts">
          <div><dt>克制</dt><dd>${detail.restraints?.strongAgainst?.length ? detail.restraints.strongAgainst.map(typeBadgeHtml).join("") : "暂无"}</dd></div>
          <div><dt>被克制</dt><dd>${detail.restraints?.weakAgainst?.length ? detail.restraints.weakAgainst.map(typeBadgeHtml).join("") : "暂无"}</dd></div>
        </dl>
      </section>

      <section class="detail-panel wide">
        <h3>技能列表 <span>${detail.skills?.length || 0}</span></h3>
        <div class="skill-table">
          ${detail.skills?.length
            ? detail.skills.map((skill) => `
                <article>
                  <strong>${escapeHtml(skill.name)}</strong>
                  <span>${escapeHtml([skill.level, skill.attribute, skill.category, skill.power ? `威力 ${skill.power}` : ""].filter(Boolean).join(" · "))}</span>
                  <p>${escapeHtml(skill.description)}</p>
                </article>
              `).join("")
            : `<p class="empty">暂无技能资料。</p>`}
        </div>
      </section>
    </div>
  `;
  $("#backToDex").addEventListener("click", () => setView("spirits"));
  elements.detailContent.querySelectorAll(".evolution-list button[data-wiki-url]").forEach((button) => {
    button.addEventListener("click", () => {
      renderDetailView(button.dataset.wikiUrl);
    });
  });
}

function toggleDexFilter(group, value) {
  if (group === "shiny") {
    state.dexFilters.shiny = state.dexFilters.shiny === value ? "" : value;
  } else if (state.dexFilters[group].has(value)) {
    state.dexFilters[group].delete(value);
  } else {
    state.dexFilters[group].add(value);
  }
  renderDexControls();
  renderDexGrid();
}

function resetDexFilters() {
  state.dexFilters.query = "";
  state.dexFilters.stages.clear();
  state.dexFilters.types.clear();
  state.dexFilters.specials.clear();
  state.dexFilters.shiny = "";
  state.dexFilters.eggGroup = "";
  state.dexFilters.sort = "number";
  renderDexControls();
  renderDexGrid();
}

async function runSearch(query) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=18`);
  const data = await response.json();
  state.latestResults = data;
  renderInspector(data);
}

async function loadData() {
  const response = await fetch("/api/data");
  state.data = await response.json();
  renderDataViews();
}

async function submitChat(forcedMessage) {
  const message = String(forcedMessage || elements.chatInput.value || "").trim();
  if (!message || state.chatting) return;

  setView("assistant");
  state.messages.push({ role: "user", content: message });
  elements.chatInput.value = "";
  state.chatting = true;
  elements.status.textContent = "思考中";
  elements.sendBtn.disabled = true;
  renderMessages();
  await runSearch(message);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        history: state.messages.slice(0, -1),
        password: elements.password.value
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `接口返回 ${response.status}`);
    }
    elements.modelStatus.textContent = data.mode === "llm" ? "模型回答已启用" : "本地摘要模式";
    if (data.warning) {
      elements.modelStatus.textContent = data.warning;
    }
    state.messages.push({ role: "assistant", content: data.answer || data.error || "这次没有拿到可用回答。" });
  } catch (error) {
    const detail = error?.message ? `（${error.message}）` : "";
    state.messages.push({ role: "assistant", content: `接口暂时不可用${detail}，可以先用右侧资料查询。` });
  } finally {
    state.chatting = false;
    elements.status.textContent = "就绪";
    elements.sendBtn.disabled = false;
    renderMessages();
  }
}

function wireEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#newChat").addEventListener("click", () => {
    state.messages = [{ role: "assistant", content: "新对话已开始。" }];
    renderMessages();
    setView("assistant");
  });

  let searchTimer;
  elements.lookup.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (state.activeView === "spirits") {
        state.dexFilters.query = elements.lookup.value;
        elements.spiritSearch.value = elements.lookup.value;
        renderDexGrid();
      }
      runSearch(elements.lookup.value);
    }, 120);
  });

  elements.spiritSearch.addEventListener("input", () => {
    state.dexFilters.query = elements.spiritSearch.value;
    renderDexGrid();
  });
  elements.dexEggGroup.addEventListener("change", () => {
    state.dexFilters.eggGroup = elements.dexEggGroup.value;
    renderDexGrid();
  });
  elements.dexSort.addEventListener("change", () => {
    state.dexFilters.sort = elements.dexSort.value;
    renderDexGrid();
  });
  elements.dexReset.addEventListener("click", resetDexFilters);
  [elements.dexStageFilters, elements.dexSpecialFilters, elements.dexShinyFilters, elements.dexTypeFilters].forEach((container) => {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-filter-group]");
      if (!button) return;
      toggleDexFilter(button.dataset.filterGroup, button.dataset.filterValue);
    });
  });
  elements.dexGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-wiki-url]");
    if (!button) return;
    renderDetailView(button.dataset.wikiUrl);
  });

  elements.exchangeFilter.addEventListener("input", () => {
    state.communityFilter = elements.exchangeFilter.value;
    renderCommunityExchange();
  });
  document.querySelectorAll("[data-exchange-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.exchangeSort;
      if (state.exchangeSort.field === field) {
        state.exchangeSort.direction = state.exchangeSort.direction === "asc" ? "desc" : "asc";
      } else {
        state.exchangeSort = { field, direction: "asc" };
      }
      renderCommunityExchange();
    });
  });
  document.querySelectorAll("[data-exchange-filter]").forEach((input) => {
    input.addEventListener("input", () => {
      state.exchangeFilters[input.dataset.exchangeFilter] = input.value;
      renderCommunityExchange();
    });
    input.addEventListener("change", () => {
      state.exchangeFilters[input.dataset.exchangeFilter] = input.value;
      renderCommunityExchange();
    });
  });
  elements.exchangeClearFilters.addEventListener("click", () => {
    state.communityFilter = "";
    state.exchangeFilters = {};
    elements.exchangeFilter.value = "";
    document.querySelectorAll("[data-exchange-filter]").forEach((input) => {
      input.value = "";
    });
    renderCommunityExchange();
  });
  elements.exchangeAddRow.addEventListener("click", addExchangeRow);
  elements.exchangeSaveAll.addEventListener("click", async () => {
    setButtonLoading(elements.exchangeSaveAll, true, "保存中");
    try {
      await saveAllExchangeRows();
    } catch (error) {
      setExchangeStatus(error.message || "保存失败");
    } finally {
      setButtonLoading(elements.exchangeSaveAll, false);
    }
  });
  elements.exchangeRefresh.addEventListener("click", async () => {
    setButtonLoading(elements.exchangeRefresh, true, "刷新中");
    try {
      await loadCommunityExchange();
      await runSearch(elements.lookup.value);
    } finally {
      setButtonLoading(elements.exchangeRefresh, false);
    }
  });
  elements.exchangeTableBody.addEventListener("input", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field) return;
    const row = field.closest("tr[data-entry-id]");
    markExchangeDirty(row);
  });
  elements.exchangeTableBody.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (!field) return;
    const row = field.closest("tr[data-entry-id]");
    if (field.dataset.field === "spirit") {
      const eggGroupInput = row.querySelector("[data-field='eggGroups']");
      const spirit = getSpiritByName(field.value);
      if (spirit && eggGroupInput && !eggGroupInput.value.trim()) {
        eggGroupInput.value = spirit.eggGroups.join("、");
      }
    }
    markExchangeDirty(row);
  });
  elements.exchangeTableBody.addEventListener("click", async (event) => {
    const saveButton = event.target.closest("button[data-save-entry]");
    const deleteButton = event.target.closest("button[data-delete-entry]");
    if (saveButton) {
      const row = saveButton.closest("tr[data-entry-id]");
      setButtonLoading(saveButton, true, "保存中");
      try {
        await saveExchangeRow(row);
      } catch (error) {
        setExchangeStatus(error.message || "保存失败");
      } finally {
        setButtonLoading(saveButton, false);
      }
      return;
    }
    if (deleteButton) {
      setButtonLoading(deleteButton, true, "删除中");
      try {
        await saveCommunity({ action: "deleteEntry", id: deleteButton.dataset.deleteEntry });
        setExchangeStatus("已删除这一行");
      } catch (error) {
        setExchangeStatus(error.message || "删除失败");
      } finally {
        setButtonLoading(deleteButton, false);
      }
    }
  });

  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitChat();
  });

  elements.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChat();
    }
  });

  elements.quickList.innerHTML = starters.map((item) => `<button type="button">${escapeHtml(item)}</button>`).join("");
  elements.quickList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => submitChat(button.textContent));
  });
}

wireEvents();
renderMessages();
await loadData();
populateSpiritList();
populateNatureList();
await loadCommunityExchange();
await runSearch("");
