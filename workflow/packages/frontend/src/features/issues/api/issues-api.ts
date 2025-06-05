import { api } from '@/lib/api';
import {
    IssueStatus,
    ListIssuesParams,
    PopulatedIssue,
    UpdateIssueRequestBody,
} from 'workflow-axb-shared';
import { SeekPage } from 'workflow-shared';

export const issuesApi = {
  list(request: ListIssuesParams): Promise<SeekPage<PopulatedIssue>> {
    return api.get<SeekPage<PopulatedIssue>>('/v1/issues', request);
  },
  resolve(issueId: string) {
    const body: UpdateIssueRequestBody = {
      status: IssueStatus.RESOLEVED,
    };

    return api.post<void>(`/v1/issues/${issueId}`, body);
  },
  count() {
    return api.get<number>('/v1/issues/count');
  },
  v2: {
    list(request: ListIssuesParams): Promise<SeekPage<PopulatedIssue>> {
      return api.get<SeekPage<PopulatedIssue>>('/v2/issues', request);
    },
  }
};
