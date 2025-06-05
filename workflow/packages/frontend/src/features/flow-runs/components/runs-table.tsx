import { useMutation, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { t } from 'i18next';
import { Calendar, CheckIcon, ChevronDown, History, PlayIcon, Redo, RotateCw, Workflow } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FlowRetryStrategy, FlowRun, FlowRunStatus, isFailedState, Permission } from 'workflow-shared';

import { useNewWindow } from '@/components/embed-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkAction, CURSOR_QUERY_PARAM, DataTable, LIMIT_QUERY_PARAM, PAGE_QUERY_PARAM, RowDataWithActions } from '@/components/ui/data-table';
import { DataTableColumnHeader } from '@/components/ui/data-table/data-table-column-header';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusIconWithText } from '@/components/ui/status-icon-with-text';
import { INTERNAL_ERROR_TOAST, toast } from '@/components/ui/use-toast';
import { flowRunUtils } from '@/features/flow-runs/lib/flow-run-utils';
import { flowRunsApi } from '@/features/flow-runs/lib/flow-runs-api';
import { flowsHooks } from '@/features/flows/lib/flows-hooks';
import { useAuthorization } from '@/hooks/authorization-hooks';
import { authenticationSession } from '@/lib/authentication-session';
import { cn, formatUtils } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PermissionNeededTooltip } from '@/components/ui/permission-needed-tooltip';
import { MessageTooltip } from '@/components/ui/message-tooltip';

type SelectedRow = {
  id: string;
  status: FlowRunStatus;
};

export const RunsTable = () => {
  const [searchParams] = useSearchParams();
  const [selectedRows, setSelectedRows] = useState<Array<SelectedRow>>([]);
  const [selectedAll, setSelectedAll] = useState(false);
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set());
  const projectId = authenticationSession.getProjectId()!;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['flow-run-table', searchParams.toString(), projectId],
    staleTime: 0,
    gcTime: 0,
    queryFn: () => {
      const status = searchParams.getAll('status') as FlowRunStatus[];
      const flowId = searchParams.getAll('flowId');
      const cursor = searchParams.get(CURSOR_QUERY_PARAM);
      const limit = searchParams.get(LIMIT_QUERY_PARAM) ? parseInt(searchParams.get(LIMIT_QUERY_PARAM)!) : 10;
      const page = searchParams.get(LIMIT_QUERY_PARAM) ? parseInt(searchParams.get(PAGE_QUERY_PARAM)!) : 1;
      const createdAfter = searchParams.get('createdAfter');
      const createdBefore = searchParams.get('createdBefore');

      return flowRunsApi.v2.list({
        status: status ?? undefined,
        projectId,
        flowId,
        cursor: cursor ?? undefined,
        limit,
        page,
        createdAfter: createdAfter ?? undefined,
        createdBefore: createdBefore ?? undefined,
      });
    },
  });

  const navigate = useNavigate();
  const { data: flowsData, isFetching: isFetchingFlows } = flowsHooks.useFlows({
    limit: 1000,
  });
  const openNewWindow = useNewWindow();
  const flows = flowsData?.data;
  const { checkAccess } = useAuthorization();
  const userHasPermissionToRetryRun = checkAccess(Permission.WRITE_RUN);

  const filters = useMemo(
    () => [
      {
        type: 'select',
        title: t('Flow name'),
        accessorKey: 'flowId',
        options:
          flows?.map((flow) => ({
            label: flow.version.displayName,
            value: flow.id,
          })) || [],
        icon: CheckIcon,
      } as const,
      {
        type: 'select',
        title: t('Status'),
        accessorKey: 'status',
        options: Object.values(FlowRunStatus)
          .filter((status) => status !== FlowRunStatus.STOPPED)
          .map((status) => {
            return {
              label: formatUtils.convertEnumToHumanReadable(status),
              value: status,
              icon: flowRunUtils.getStatusIcon(status).Icon,
            };
          }),
        icon: CheckIcon,
      } as const,
      {
        type: 'date',
        title: t('Created'),
        accessorKey: 'created',
        options: [],
        icon: CheckIcon,
      } as const,
    ],
    [flows]
  );

  const replayRun = useMutation({
    mutationFn: (retryParams: { runIds: string[]; strategy: FlowRetryStrategy }) => {
      const status = searchParams.getAll('status') as FlowRunStatus[];
      const flowId = searchParams.getAll('flowId');
      const createdAfter = searchParams.get('createdAfter') || undefined;
      const createdBefore = searchParams.get('createdBefore') || undefined;
      return flowRunsApi.bulkRetry({
        projectId: authenticationSession.getProjectId()!,
        flowRunIds: selectedAll ? undefined : retryParams.runIds,
        strategy: retryParams.strategy,
        excludeFlowRunIds: selectedAll ? Array.from(excludedRows) : undefined,
        status,
        flowId,
        createdAfter,
        createdBefore,
      });
    },
    onSuccess: () => {
      toast({
        title: t('Runs replayed successfully'),
        variant: 'default',
      });
      refetch();
    },
    onError: () => {
      toast(INTERNAL_ERROR_TOAST);
    },
  });

  const bulkActions: BulkAction<FlowRun>[] = useMemo(
    () => [
      {
        render: (_, resetSelection) => {
          const allFailed = selectedRows.every((row) =>
            isFailedState(row.status),
          );
          const isDisabled =
            selectedRows.length === 0 || !userHasPermissionToRetryRun;

          return (
            <div onClick={(e) => e.stopPropagation()}>
              <PermissionNeededTooltip
                hasPermission={userHasPermissionToRetryRun}
              >
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild disabled={isDisabled}>
                    <Button disabled={isDisabled} className="h-9 w-full">
                      <PlayIcon className="mr-2 h-3 w-4" />
                      {selectedRows.length > 0
                        ? `${t('Retry')} ${
                            selectedAll
                              ? excludedRows.size > 0
                                ? `${t('all except')} ${excludedRows.size}`
                                : t('all')
                              : `(${selectedRows.length})`
                          }`
                        : t('Retry')}
                      <ChevronDown className="h-3 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <PermissionNeededTooltip
                      hasPermission={userHasPermissionToRetryRun}
                    >
                      <DropdownMenuItem
                        disabled={!userHasPermissionToRetryRun}
                        onClick={() => {
                          replayRun.mutate({
                            runIds: selectedRows.map((row) => row.id),
                            strategy: FlowRetryStrategy.ON_LATEST_VERSION,
                          });
                          resetSelection();
                          setSelectedRows([]);
                        }}
                        className="cursor-pointer"
                      >
                        <div className="flex flex-row gap-2 items-center">
                          <RotateCw className="h-4 w-4" />
                          <span>{t('on latest version')}</span>
                        </div>
                      </DropdownMenuItem>
                    </PermissionNeededTooltip>

                    {selectedRows.some((row) => isFailedState(row.status)) && (
                      <MessageTooltip
                        message={t(
                          'Only failed runs can be retried from failed step',
                        )}
                        isDisabled={!allFailed}
                      >
                        <DropdownMenuItem
                          disabled={!userHasPermissionToRetryRun || !allFailed}
                          onClick={() => {
                            replayRun.mutate({
                              runIds: selectedRows.map((row) => row.id),
                              strategy: FlowRetryStrategy.FROM_FAILED_STEP,
                            });
                            resetSelection();
                            setSelectedRows([]);
                            setSelectedAll(false);
                            setExcludedRows(new Set());
                          }}
                          className="cursor-pointer"
                        >
                          <div className="flex flex-row gap-2 items-center">
                            <Redo className="h-4 w-4" />
                            <span>{t('from failed step')}</span>
                          </div>
                        </DropdownMenuItem>
                      </MessageTooltip>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PermissionNeededTooltip>
            </div>
          );
        },
      },
    ],
    [replayRun, userHasPermissionToRetryRun, t, selectedRows, data],
  );

  const handleRowClick = useCallback(
    (row: FlowRun, newWindow: boolean) => {
      if (newWindow) {
        openNewWindow(authenticationSession.appendProjectRoutePrefix(`/runs/${row.id}`));
      } else {
        navigate(authenticationSession.appendProjectRoutePrefix(`/runs/${row.id}`));
      }
    },
    [navigate, openNewWindow]
  );

  const columns: ColumnDef<RowDataWithActions<FlowRun>>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <div className="flex items-center">
          <Checkbox
            checked={selectedAll || table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => {
              const isChecked = !!value;
              table.toggleAllPageRowsSelected(isChecked);

              if (isChecked) {
                const currentPageRows = table.getRowModel().rows.map((row) => ({
                  id: row.original.id,
                  status: row.original.status,
                }));

                setSelectedRows((prev) => {
                  const uniqueRows = new Map<string, SelectedRow>([
                    ...prev.map((row) => [row.id, row] as [string, SelectedRow]),
                    ...currentPageRows.map((row) => [row.id, row] as [string, SelectedRow]),
                  ]);

                  return Array.from(uniqueRows.values());
                });
              } else {
                setSelectedAll(false);
                setSelectedRows([]);
                setExcludedRows(new Set());
              }
            }}
          />
          {selectedRows.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="z-50">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    const currentPageRows = table.getRowModel().rows.map((row) => ({
                      id: row.original.id,
                      status: row.original.status,
                    }));
                    setSelectedRows(currentPageRows);
                    setSelectedAll(false);
                    setExcludedRows(new Set());
                    table.toggleAllPageRowsSelected(true);
                  }}
                >
                  {t('Select shown')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    if (data?.data) {
                      const allRows = data.data.map((row) => ({
                        id: row.id,
                        status: row.status,
                      }));
                      setSelectedRows(allRows);
                      setSelectedAll(true);
                      setExcludedRows(new Set());
                      table.toggleAllPageRowsSelected(true);
                    }
                  }}
                >
                  {t('Select all')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
      cell: ({ row }) => {
        const isExcluded = excludedRows.has(row.original.id);
        const isSelected = selectedAll ? !isExcluded : selectedRows.some((selectedRow) => selectedRow.id === row.original.id);

        return (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(value) => {
              const isChecked = !!value;

              if (selectedAll) {
                if (isChecked) {
                  const newExcluded = new Set(excludedRows);
                  newExcluded.delete(row.original.id);
                  setExcludedRows(newExcluded);
                } else {
                  setExcludedRows(new Set([...excludedRows, row.original.id]));
                }
              } else {
                if (isChecked) {
                  setSelectedRows((prev) => [
                    ...prev,
                    {
                      id: row.original.id,
                      status: row.original.status,
                    },
                  ]);
                } else {
                  setSelectedRows((prev) => prev.filter((selectedRow) => selectedRow.id !== row.original.id));
                }
              }
              row.toggleSelected(isChecked);
            }}
          />
        );
      },
    },
    {
      accessorKey: 'flowId',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Flow')} />,
      cell: ({ row }) => {
        return <div className="text-left">{row.original.flowDisplayName}</div>;
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Status')} />,
      cell: ({ row }) => {
        const status = row.original.status;
        const { variant, Icon } = flowRunUtils.getStatusIcon(status);
        return (
          <div className="text-left">
            <StatusIconWithText icon={Icon} text={formatUtils.convertEnumToHumanReadable(status)} variant={variant} />
          </div>
        );
      },
    },
    {
      accessorKey: 'created',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Start Time')} />,
      cell: ({ row }) => {
        return <div className="text-left">{formatUtils.formatDate(new Date(row.original.startTime))}</div>;
      },
    },
    {
      accessorKey: 'duration',
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('Duration')} />,
      cell: ({ row }) => {
        return <div className="text-left">{row.original.finishTime && formatUtils.formatDuration(row.original.duration)}</div>;
      },
    },
  ];

  return (
    <DataTable
      emptyStateTextTitle={t('No flow runs found')}
      emptyStateTextDescription={t('Come back later when your automations start running')}
      emptyStateIcon={<History className="size-14" />}
      columns={columns}
      page={data}
      isLoading={isLoading || isFetchingFlows}
      filters={filters}
      customContent={() => {
        if (!data?.data?.length)
          return (
            <div className="flex flex-col items-center justify-center gap-2">
              <History className="size-14" />
              <p className="text-lg font-semibold">{t('No flow runs found')}</p>
              <p className="text-sm text-muted-foreground ">{t('Come back later when your automations start running')}</p>
            </div>
          );
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.data.map((run) => {
              const { variant, Icon } = flowRunUtils.getStatusIcon(run.status);
              return (
                <Card
                  className={cn(
                    'overflow-hidden transition-all duration-200 relative border-border cursor-pointer h-full',
                    'hover:shadow-md hover:border-primary/30 hover:bg-accent/10'
                  )}
                  onClick={(e) => {
                    handleRowClick(run, e.ctrlKey);
                  }}
                  onAuxClick={(e) => {
                    handleRowClick(run, e.ctrlKey);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-foreground truncate text-sm min-w-0 flex-1">{run.flowDisplayName}</h4>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center space-x-1 text-xs text-muted-foreground flex-shrink-0">
                              <Calendar className="h-3 w-3" />
                              <span className="whitespace-nowrap">{formatUtils.formatDate(new Date(run.created))}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{t('Start Time')}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="w-full mt-5 flex justify-between items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <StatusIconWithText icon={Icon} text={formatUtils.convertEnumToHumanReadable(run.status)} variant={variant} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>{t('Status')}</TooltipContent>
                        </Tooltip>
                        <div className="flex gap-1 items-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="text-left">{run.finishTime && formatUtils.formatDuration(run.duration)}</div>
                            </TooltipTrigger>
                            <TooltipContent>{t('Duration')}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  replayRun.mutate({
                                    runIds: [run.id],
                                    strategy: FlowRetryStrategy.ON_LATEST_VERSION,
                                  });
                                }}
                                className="rounded-full p-2 hover:bg-muted cursor-pointer"
                              >
                                <RotateCw className="h-4 w-4" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>{t('Retry on latest version')}</TooltipContent>
                          </Tooltip>
                          {isFailedState(run.status) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    replayRun.mutate({
                                      runIds: [run.id],
                                      strategy: FlowRetryStrategy.FROM_FAILED_STEP,
                                    });
                                  }}
                                  className="rounded-full p-2 hover:bg-muted cursor-pointer"
                                >
                                  <Redo className="h-4 w-4" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>{t('Retry from failed step')}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        );
      }}
    />
  );
};
