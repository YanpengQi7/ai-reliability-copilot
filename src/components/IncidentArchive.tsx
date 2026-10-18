import Link from "next/link";
import {
  ARCHIVE_LIMITS,
  ARCHIVE_PAGE_SIZE,
  archiveHref,
  hasArchiveFilters,
  type ArchiveFilters,
  type ArchiveParamIssue,
} from "@/lib/incidentArchive";
import type { IncidentArchiveRow } from "@/lib/incidentArchiveQuery";
import type { Locale } from "@/lib/i18n/messages";

const LABELS = {
  en: {
    title: "Find incidents",
    search: "Search",
    searchPlaceholder: "e.g. payment timeout",
    searchHint: "Searches titles, services, and symptoms for literal text, ignoring case.",
    service: "Service (exact name)",
    servicePlaceholder: "e.g. payment-api",
    serviceHint: "Matches the full service name, including capitalization.",
    from: "Created from (UTC)",
    to: "Created through (UTC)",
    dateHint: "Created dates use UTC. Both selected dates are included.",
    apply: "Apply filters",
    clear: "Clear all filters",
    issues: "Check the archive filters",
    issuesHint: "Correct the fields below, then apply the filters again.",
    fields: { q: "Search", service: "Service", from: "Created from", to: "Created through", after: "Older-page link" },
    errors: {
      multiple: "Use this field only once in the address.",
      too_long: "Use no more than",
      invalid_date: "Use a valid date in YYYY-MM-DD format.",
      date_range: "The start date must be on or before the end date.",
      invalid_cursor: "This page link is invalid or does not match the current filters. Return to the newest matches.",
      invalid_text: "This field contains unsupported text characters. Remove them and try again.",
    },
    characters: "characters.",
    count: "incidents on this page",
    perPage: "Up to 25 per page · newest first",
    created: "Created",
    notRecorded: "Not recorded",
    untitled: "Untitled incident",
    serviceFilter: "Filter by service:",
    pagination: "Incident archive pages",
    older: "Older matches",
    newest: "Newest matches",
    noOlderTitle: "No older matches on this page",
    noOlderBody: "The archive may have changed since this page link was created. Return to the newest matches for these filters.",
    noMatchesTitle: "No incidents match these filters",
    noMatchesBody: "Adjust the search, service, or created-date range, or clear the filters.",
    emptyTitle: "No incidents yet",
    emptyBody: "Analyze an incident on the New page to start your archive.",
    newIncident: "Analyze an incident",
    failedTitle: "Could not load the incident archive",
    failedBody: "The request failed or took too long. Retry this page or adjust the filters.",
    retry: "Retry this page",
  },
  zh: {
    title: "查找故障",
    search: "搜索",
    searchPlaceholder: "如：支付超时",
    searchHint: "在标题、服务和症状中搜索输入的原文，不区分大小写。",
    service: "服务（完整名称）",
    servicePlaceholder: "如：payment-api",
    serviceHint: "匹配完整服务名称，包括大小写。",
    from: "创建日期从（UTC）",
    to: "创建日期至（UTC）",
    dateHint: "创建日期使用 UTC 时区，包含所选的起止日期。",
    apply: "应用筛选",
    clear: "清除全部筛选",
    issues: "请检查故障档案筛选条件",
    issuesHint: "请更正下方字段，然后重新应用筛选。",
    fields: { q: "搜索", service: "服务", from: "起始创建日期", to: "截止创建日期", after: "较早记录页面链接" },
    errors: {
      multiple: "地址中此字段只能出现一次。",
      too_long: "字符数不能超过",
      invalid_date: "请使用 YYYY-MM-DD 格式的有效日期。",
      date_range: "起始日期必须早于或等于截止日期。",
      invalid_cursor: "此页面链接无效，或与当前筛选条件不符。请返回最新匹配记录。",
      invalid_text: "此字段包含不支持的文本字符。请删除这些字符后重试。",
    },
    characters: "字符。",
    count: "条故障记录位于本页",
    perPage: "每页最多 25 条 · 按创建时间从新到旧排列",
    created: "创建时间",
    notRecorded: "未记录",
    untitled: "未命名故障",
    serviceFilter: "按服务筛选：",
    pagination: "故障档案分页",
    older: "较早的匹配记录",
    newest: "最新的匹配记录",
    noOlderTitle: "本页没有更早的匹配记录",
    noOlderBody: "此页面链接生成后，故障档案可能发生了变化。请返回这些筛选条件下的最新匹配记录。",
    noMatchesTitle: "没有符合筛选条件的故障",
    noMatchesBody: "请调整搜索、服务或创建日期范围，或清除筛选条件。",
    emptyTitle: "暂无故障记录",
    emptyBody: "在「新建」页面分析故障，即可开始建立故障档案。",
    newIncident: "分析故障",
    failedTitle: "无法加载故障档案",
    failedBody: "请求失败或用时过长。请重试本页或调整筛选条件。",
    retry: "重试本页",
  },
};

const LINK_CLASS = "inline-flex max-w-full items-center rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400";
const INPUT_CLASS = "min-w-0 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-2 focus-visible:outline-indigo-400";

function issueMessage(issue: ArchiveParamIssue, locale: Locale): string {
  const labels = LABELS[locale];
  if (issue.code === "too_long") {
    const limit = issue.field === "q" ? ARCHIVE_LIMITS.q : issue.field === "service" ? ARCHIVE_LIMITS.service : ARCHIVE_LIMITS.cursor;
    return `${labels.errors.too_long} ${limit.toLocaleString(locale)} ${labels.characters}`;
  }
  return labels.errors[issue.code];
}

function CreatedDate({ value, locale }: { value: string | null; locale: Locale }) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return <span>{LABELS[locale].notRecorded}</span>;
  return <time dateTime={date.toISOString()}>{date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</time>;
}

export function IncidentArchive({ filters, issues, incidents, nextCursor, isOlderPage, failed = false, locale, retryHref }: {
  filters: ArchiveFilters;
  issues: ArchiveParamIssue[];
  incidents: IncidentArchiveRow[];
  nextCursor: string | null;
  isOlderPage: boolean;
  failed?: boolean;
  locale: Locale;
  retryHref?: string;
}) {
  const labels = LABELS[locale];
  const filtered = hasArchiveFilters(filters);
  const hasIssue = (field: ArchiveParamIssue["field"]) => issues.some((issue) => issue.field === field);
  const newestHref = archiveHref(filters);
  const cursorOnlyIssue = issues.length > 0 && issues.every((issue) => issue.field === "after");

  return (
    <div className="min-w-0 space-y-5">
      <section aria-labelledby="incident-archive-search-title" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 md:p-5">
        <h2 id="incident-archive-search-title" className="text-lg font-semibold">{labels.title}</h2>
        {/* An empty native GET submission also clears unsent inputs on the same URL. */}
        <form id="incident-archive-reset" action="/incidents" method="get" hidden />
        {issues.length > 0 && (
          <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">
            <h3 className="font-medium">{labels.issues}</h3>
            <ul id="incident-archive-issues" className="mt-2 list-disc space-y-1 pl-5">
              {issues.map((issue, index) => <li key={index}><span className="font-medium">{labels.fields[issue.field]}: </span>{issueMessage(issue, locale)}</li>)}
            </ul>
            <p className="mt-2 text-xs text-neutral-400">{labels.issuesHint}</p>
            {cursorOnlyIssue && <Link href={newestHref} prefetch={false} className={`${LINK_CLASS} mt-3`}>{labels.newest}</Link>}
          </div>
        )}
        <form key={retryHref ?? archiveHref(filters)} method="get" action="/incidents" className="mt-4 space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label htmlFor="incident-archive-q" className="flex min-w-0 flex-col gap-1 text-sm text-neutral-400">
              <span>{labels.search}</span>
              <input id="incident-archive-q" name="q" type="search" defaultValue={filters.q} maxLength={ARCHIVE_LIMITS.q} placeholder={labels.searchPlaceholder} aria-invalid={hasIssue("q")} aria-describedby={`incident-archive-q-hint${hasIssue("q") ? " incident-archive-issues" : ""}`} className={INPUT_CLASS} />
              <span id="incident-archive-q-hint" className="text-xs text-neutral-500">{labels.searchHint}</span>
            </label>
            <label htmlFor="incident-archive-service" className="flex min-w-0 flex-col gap-1 text-sm text-neutral-400">
              <span>{labels.service}</span>
              <input id="incident-archive-service" name="service" defaultValue={filters.service} maxLength={ARCHIVE_LIMITS.service} placeholder={labels.servicePlaceholder} aria-invalid={hasIssue("service")} aria-describedby={`incident-archive-service-hint${hasIssue("service") ? " incident-archive-issues" : ""}`} className={INPUT_CLASS} />
              <span id="incident-archive-service-hint" className="text-xs text-neutral-500">{labels.serviceHint}</span>
            </label>
            <label htmlFor="incident-archive-from" className="flex min-w-0 flex-col gap-1 text-sm text-neutral-400">
              <span>{labels.from}</span>
              <input id="incident-archive-from" name="from" type="date" min="0001-01-01" max="9999-12-31" defaultValue={filters.from} aria-invalid={hasIssue("from")} aria-describedby={`incident-archive-date-hint${hasIssue("from") ? " incident-archive-issues" : ""}`} style={{ colorScheme: "dark" }} className={INPUT_CLASS} />
            </label>
            <label htmlFor="incident-archive-to" className="flex min-w-0 flex-col gap-1 text-sm text-neutral-400">
              <span>{labels.to}</span>
              <input id="incident-archive-to" name="to" type="date" min="0001-01-01" max="9999-12-31" defaultValue={filters.to} aria-invalid={hasIssue("to")} aria-describedby={`incident-archive-date-hint${hasIssue("to") ? " incident-archive-issues" : ""}`} style={{ colorScheme: "dark" }} className={INPUT_CLASS} />
            </label>
          </div>
          <p id="incident-archive-date-hint" className="text-xs text-neutral-500">{labels.dateHint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{labels.apply}</button>
            <button type="submit" form="incident-archive-reset" className={LINK_CLASS}>{labels.clear}</button>
          </div>
        </form>
      </section>

      {issues.length === 0 && (failed ? (
        <section role="alert" className="rounded-xl border border-amber-500/30 bg-neutral-900 p-5">
          <h2 className="text-lg font-semibold text-amber-200">{labels.failedTitle}</h2>
          <p className="mt-2 text-sm text-neutral-400">{labels.failedBody}</p>
          <a href={retryHref ?? newestHref} className={`${LINK_CLASS} mt-4`}>{labels.retry}</a>
        </section>
      ) : incidents.length > 0 ? (
        <section aria-label={labels.pagination} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <p><span className="font-medium text-neutral-300">{incidents.length.toLocaleString(locale)}</span> {labels.count}</p>
            <p>{labels.perPage.replace("25", String(ARCHIVE_PAGE_SIZE))}</p>
          </div>
          <ul className="min-w-0 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {incidents.map((incident) => (
              <li key={incident.id} className="min-w-0 p-4 md:px-5">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <h3 className="min-w-0 break-words font-medium"><Link href={`/incidents/${encodeURIComponent(incident.id)}`} prefetch={false} className="text-neutral-100 hover:text-indigo-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{incident.title || incident.service || labels.untitled}</Link></h3>
                  <p className="shrink-0 text-xs text-neutral-500"><span className="sr-only">{labels.created}: </span><CreatedDate value={incident.created_at} locale={locale} /></p>
                </div>
                {incident.symptoms && <p className="mt-2 line-clamp-2 break-words text-sm text-neutral-400">{incident.symptoms}</p>}
                {incident.service && <Link href={archiveHref({ ...filters, service: incident.service })} prefetch={false} aria-label={`${labels.serviceFilter} ${incident.service}`} className="mt-3 inline-block max-w-full break-words rounded-md border border-neutral-700 bg-neutral-950/40 px-2 py-1 text-xs text-indigo-300 hover:border-indigo-500/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400">{incident.service}</Link>}
              </li>
            ))}
          </ul>
          {(isOlderPage || nextCursor) && <nav aria-label={labels.pagination} className="flex flex-wrap justify-between gap-3">
            {isOlderPage && <Link href={newestHref} prefetch={false} className={LINK_CLASS}>{labels.newest}</Link>}
            {nextCursor && <Link href={archiveHref(filters, nextCursor)} prefetch={false} className={`${LINK_CLASS} ml-auto`}>{labels.older}</Link>}
          </nav>}
        </section>
      ) : (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center md:p-10">
          <h2 className="text-lg font-semibold">{isOlderPage ? labels.noOlderTitle : filtered ? labels.noMatchesTitle : labels.emptyTitle}</h2>
          <p className="mt-2 text-sm text-neutral-400">{isOlderPage ? labels.noOlderBody : filtered ? labels.noMatchesBody : labels.emptyBody}</p>
          {isOlderPage
            ? <Link href={newestHref} prefetch={false} className={`${LINK_CLASS} mt-4`}>{labels.newest}</Link>
            : filtered
              ? <button type="submit" form="incident-archive-reset" className={`${LINK_CLASS} mt-4`}>{labels.clear}</button>
              : <Link href="/" prefetch={false} className={`${LINK_CLASS} mt-4`}>{labels.newIncident}</Link>}
        </section>
      ))}
    </div>
  );
}
