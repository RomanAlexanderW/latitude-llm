import { create } from 'zustand'
import {
  DEFAULTS_ISSUE_PARAMS,
  IssuesFiltersQueryParamsInput,
  SafeIssuesParams,
} from '@latitude-data/constants/issues'
import { convertIssuesParamsToQueryParams } from '@latitude-data/constants/issues'

type IssuesParametersState = {
  limit: number
  filters: SafeIssuesParams['filters']
  sorting: SafeIssuesParams['sorting']

  // Computed values
  urlParameters: Partial<IssuesFiltersQueryParamsInput> | undefined
}

type IssuesParameters = IssuesParametersState & {
  init: (_args: { params: SafeIssuesParams }) => void
  setFilters: (filters: Partial<SafeIssuesParams['filters']>) => void
  setSorting: (sorting: Partial<SafeIssuesParams['sorting']>) => void
  setLimit: (limit: number) => void
  resetFilters: () => void
  resetSorting: () => void
}

/**
 * When the UI filters or sorting change, we need to derive
 * the URL parameters and SWR cache key.
 */
function deriveState(state: Omit<IssuesParametersState, 'urlParameters'>) {
  const urlParameters = convertIssuesParamsToQueryParams({
    params: {
      limit: state.limit,
      filters: state.filters,
      sorting: state.sorting,
    },
  })

  return {
    ...state,
    urlParameters,
  } satisfies IssuesParametersState
}

export const useIssuesParameters = create<IssuesParameters>((set, get) => ({
  init: ({ params }) => {
    const newState = {
      limit: params.limit,
      filters: params.filters,
      sorting: params.sorting,
    }

    set(deriveState(newState))
  },
  limit: DEFAULTS_ISSUE_PARAMS.limit,
  filters: {},
  sorting: DEFAULTS_ISSUE_PARAMS.sorting,

  // Derived values
  urlParameters: undefined,

  setFilters: (filters) => {
    const state = get()
    const newState = {
      ...state,
      filters: {
        ...state.filters,
        ...filters,
      },
    }
    set(deriveState(newState))
  },
  setSorting: (sorting) => {
    const state = get()
    const newState = {
      ...state,
      sorting: {
        ...get().sorting,
        ...sorting,
      },
    }
    set(deriveState(newState))
  },
  setLimit: (limit) => {
    const state = get()
    const newState = {
      ...state,
      limit,
    }
    set(deriveState(newState))
  },
  resetFilters: () => {
    const state = get()
    const newState = {
      ...state,
      filters: {},
    }
    set(deriveState(newState))
  },
  resetSorting: () => {
    const state = get()
    const newState = {
      ...state,
      sorting: DEFAULTS_ISSUE_PARAMS.sorting,
    }
    set(deriveState(newState))
  },
}))
