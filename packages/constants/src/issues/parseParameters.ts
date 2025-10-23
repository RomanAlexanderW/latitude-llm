import {
  IssuesFiltersQueryParamsInput,
  IssuesFiltersQueryParamsOutput,
  issuesFiltersQueryParamsParser,
} from './parameters'
import { DEFAULTS_ISSUE_PARAMS, QueryParams } from './constants'

export function parseIssuesQueryParams(
  params: URLSearchParams | QueryParams,
): IssuesFiltersQueryParamsOutput {
  return issuesFiltersQueryParamsParser.parse(
    params instanceof URLSearchParams ? Object.fromEntries(params) : params,
  )
}

function parseStatuses(
  statuses: IssuesFiltersQueryParamsOutput['filters']['statuses'],
): string | undefined {
  if (!statuses) return undefined

  return statuses.join(',')
}

function parseDirection(
  direction: IssuesFiltersQueryParamsOutput['sorting']['direction'],
): string | undefined {
  if (direction === DEFAULTS_ISSUE_PARAMS.sorting.direction) return undefined

  return direction
}
function parseSort(
  sort: IssuesFiltersQueryParamsOutput['sorting']['sort'],
): string | undefined {
  if (sort === DEFAULTS_ISSUE_PARAMS.sorting.sort) return undefined

  return sort
}

function parseSortDirection(
  sortDirection: IssuesFiltersQueryParamsOutput['sorting']['sortDirection'],
): string | undefined {
  if (sortDirection === DEFAULTS_ISSUE_PARAMS.sorting.sortDirection) {
    return undefined
  }

  return sortDirection
}
function parseLimit(
  limit: IssuesFiltersQueryParamsOutput['limit'],
): string | undefined {
  if (limit === DEFAULTS_ISSUE_PARAMS.limit) return undefined

  return String(limit)
}

type DateRangeFields<Prefix extends string> = Record<
  `${Prefix}From` | `${Prefix}To`,
  string | undefined
>
function parseDateRange(
  range:
    | IssuesFiltersQueryParamsOutput['filters']['firstSeen']
    | IssuesFiltersQueryParamsOutput['filters']['lastSeen'],
  prefix: 'firstSeen' | 'lastSeen',
) {
  if (!range) {
    return {
      [`${prefix}From`]: undefined,
      [`${prefix}To`]: undefined,
    } as DateRangeFields<typeof prefix>
  }

  return {
    [`${prefix}From`]: range.from.toISOString(),
    [`${prefix}To`]: range.to.toISOString(),
  } as DateRangeFields<typeof prefix>
}

export function convertIssuesParamsToQueryParams({
  params,
}: {
  params: Omit<IssuesFiltersQueryParamsOutput, 'cursor'>
}): Partial<IssuesFiltersQueryParamsInput> {
  const urlParams: Omit<IssuesFiltersQueryParamsInput, 'cursor'> = {
    limit: parseLimit(params.limit),

    // Sorting
    sort: parseSort(params.sorting.sort),
    sortDirection: parseSortDirection(params.sorting.sortDirection),
    direction: parseDirection(params.sorting.direction),

    // Fileters
    query: params.filters.query,
    documentUuid: params.filters.documentUuid,
    statuses: parseStatuses(params.filters.statuses),
    ...parseDateRange(params.filters.firstSeen, 'firstSeen'),
    ...parseDateRange(params.filters.lastSeen, 'lastSeen'),
  }

  return Object.fromEntries(
    Object.entries(urlParams).filter(([, v]) => v !== undefined),
  )
}
