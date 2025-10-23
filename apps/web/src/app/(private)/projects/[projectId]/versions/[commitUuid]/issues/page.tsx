import { IssuesDashboard } from './_components/IssuesDashboard'
import {
  findCommitCached,
  findProjectCached,
} from '$/app/(private)/_data-access'
import { getCurrentUserOrRedirect } from '$/services/auth/getCurrentUser'
import { IssuesRepository } from '@latitude-data/core/repositories'
import { OkType } from '@latitude-data/core/lib/Result'
import {
  parseIssuesQueryParams,
  QueryParams,
} from '@latitude-data/constants/issues'

export type IssuesServerResponse = Awaited<
  OkType<IssuesRepository['fetchIssuesFiltered']>
>

export default async function IssuesPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; commitUuid: string }>
  searchParams: Promise<QueryParams>
}) {
  const queryParams = await searchParams
  const parsedParams = parseIssuesQueryParams(queryParams)
  const { projectId, commitUuid } = await params
  const session = await getCurrentUserOrRedirect()
  const project = await findProjectCached({
    workspaceId: session.workspace.id,
    projectId: Number(projectId),
  })
  const commit = await findCommitCached({
    uuid: commitUuid,
    projectId: Number(projectId),
  })
  const issuesRepo = new IssuesRepository(session.workspace.id)
  const args = {
    project,
    commit,
    filters: parsedParams.filters,
    sorting: parsedParams.sorting,
    cursor: parsedParams.cursor,
  }
  const serverCountResponse = await issuesRepo.fetchIssuesCount(args)
  const serverCount = serverCountResponse.unwrap()
  const serverResponse = await issuesRepo
    .fetchIssuesFiltered({
      ...args,
      limit: parsedParams.limit,
    })
    .then((r) => r.unwrap())

  return (
    <IssuesDashboard
      serverCount={serverCount}
      serverResponse={serverResponse}
      params={parsedParams}
    />
  )
}
