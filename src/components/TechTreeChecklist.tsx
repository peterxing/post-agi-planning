import { useEffect, useMemo, useState } from 'react';
import { useKV } from '@github/spark/hooks';
import type { TechTreeNode, TechTreeState, TechTreeStatus } from '@/lib/types';
import { getCumulativeTechNodes, getNodeStatusForDate } from '@/lib/tech-tree';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { CheckCircle, Circle, Flask, Users, Rocket, Globe, Lock } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
  fetchTechTreeStates,
  getSupabaseConfig,
  getUserInstanceId,
  SupabaseRestError,
  upsertTechTreeState,
} from '@/lib/supabase-client';

interface TechTreeChecklistProps {
  year: number;
  month: number;
}

const STATUS_CONFIG: Record<TechTreeStatus, { label: string; icon: typeof Circle; color: string }> = {
  'not-started': { label: 'Not Started', icon: Circle, color: 'text-muted-foreground' },
  'r-and-d': { label: 'R&D', icon: Flask, color: 'text-blue-400' },
  'pilot': { label: 'Pilot', icon: Users, color: 'text-purple-400' },
  'early-adopters': { label: 'Early Adopters', icon: Rocket, color: 'text-yellow-400' },
  'mass-market': { label: 'Mass Market', icon: Globe, color: 'text-green-400' },
  'ubiquitous': { label: 'Ubiquitous', icon: CheckCircle, color: 'text-primary' },
  'regulated': { label: 'Regulated', icon: Lock, color: 'text-destructive' },
};

const CATEGORY_LABELS = {
  individual: 'Individual',
  society: 'Society',
  economy: 'Economy',
  governance: 'Governance',
  geopolitics: 'Geopolitics',
};

const mergeStates = (existing: TechTreeState[], incoming: TechTreeState[]) => {
  const byKey = new Map<string, TechTreeState>();

  const pushState = (state: TechTreeState) => {
    const key = `${state.nodeId}-${state.effectiveYear ?? 'all'}-${state.effectiveMonth ?? 'all'}`;
    const current = byKey.get(key);
    if (!current || current.updatedAt < state.updatedAt) {
      byKey.set(key, state);
    }
  };

  (existing || []).forEach(pushState);
  (incoming || []).forEach(pushState);

  return Array.from(byKey.values()).sort((a, b) => a.updatedAt - b.updatedAt);
};

export function TechTreeChecklist({ year, month }: TechTreeChecklistProps) {
  const [techStates, setTechStates] = useKV<TechTreeState[]>('tech-tree-states', []);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['individual']);
  const [warnedAboutLocalOnly, setWarnedAboutLocalOnly] = useState(false);
  const supabaseConfig = useMemo(() => getSupabaseConfig(), []);
  const [userInstanceId, setUserInstanceId] = useState<string | null>(() => getUserInstanceId());

  useEffect(() => {
    let isCancelled = false;

    const resolveUser = async () => {
      if (!supabaseConfig) {
        const fallback = getUserInstanceId();
        if (!isCancelled) {
          setUserInstanceId(fallback);
        }
        return;
      }

      setUserInstanceId(getUserInstanceId());
    };

    resolveUser();

    return () => {
      isCancelled = true;
    };
  }, [supabaseConfig]);

  useEffect(() => {
    let isCancelled = false;

    const pullRemoteState = async () => {
      if (!supabaseConfig || !userInstanceId) return;

      try {
        const remote = await fetchTechTreeStates(supabaseConfig, userInstanceId);
        if (isCancelled || !remote) return;

        setTechStates(current => mergeStates(current || [], remote));
      } catch (error) {
        if (isCancelled) return;
        let description = error instanceof Error ? error.message : 'Unable to reach Supabase';
        if (error instanceof SupabaseRestError && error.code === 'PGRST205') {
          description =
            'Create the public.tech_tree_states table (scripts/supabase-tech-tree.sql) and reload the Supabase API schema cache.';
        }
        toast.error('Failed to load saved tech selections', { description });
      }
    };

    pullRemoteState();

    return () => {
      isCancelled = true;
    };
  }, [setTechStates, supabaseConfig, userInstanceId]);

  const cumulativeNodes = getCumulativeTechNodes(year, month);

  const nodesByCategory = cumulativeNodes.reduce((acc, node) => {
    if (!acc[node.category]) {
      acc[node.category] = [];
    }
    acc[node.category].push(node);
    return acc;
  }, {} as Record<string, TechTreeNode[]>);

  const getNodeStatus = (nodeId: string): TechTreeStatus => {
    return getNodeStatusForDate(techStates, nodeId, year, month, 'not-started');
  };

  const updateNodeStatus = (nodeId: string, status: TechTreeStatus) => {
    const nextState: TechTreeState = {
      nodeId,
      status,
      effectiveYear: year,
      effectiveMonth: month,
      updatedAt: Date.now(),
    };

    setTechStates(current => mergeStates(current || [], [nextState]));

    if (!supabaseConfig || !userInstanceId) {
      if (!warnedAboutLocalOnly) {
        setWarnedAboutLocalOnly(true);
        toast.message('Selections saved locally', {
          description: supabaseConfig
            ? 'Supabase sync is unavailable for this session, so selections stay on this device.'
            : 'Supabase is not configured, so selections stay on this device.',
        });
      }
      return;
    }

    upsertTechTreeState(supabaseConfig, userInstanceId, nextState).catch(error => {
      let description = error instanceof Error ? error.message : 'Unable to reach Supabase';
      if (error instanceof SupabaseRestError && error.code === 'PGRST205') {
        description =
          'Create the public.tech_tree_states table (scripts/supabase-tech-tree.sql) and reload the Supabase API schema cache.';
      }
      toast.error('Failed to store selection', { description });
    });
  };

  const getCompletionStats = () => {
    const total = cumulativeNodes.length;
    const statuses = cumulativeNodes.map(n => getNodeStatus(n.id));
    const notStarted = statuses.filter(s => s === 'not-started').length;
    const completed = total - notStarted;
    return { total, completed, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
  };

  const stats = getCompletionStats();

  return (
    <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Tech Tree Checklist</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Cumulative breakthroughs through {new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-primary">{stats.percentage}%</div>
            <div className="text-xs text-muted-foreground">
              {stats.completed} of {stats.total} tracked
            </div>
          </div>
        </div>

        {supabaseConfig && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              {authUserId
                ? `Signed in to Supabase as ${authUserId.slice(0, 8)}…`
                : 'Sign in with Supabase to sync selections across devices.'}
            </div>
            <div className="flex items-center gap-2">
              {authUserId ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    clearSupabaseAuthSession();
                    setAuthUserId(null);
                    setUserInstanceId(getUserInstanceId());
                    toast.message('Signed out of Supabase');
                  }}
                >
                  Sign out
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    startSupabaseOAuth(supabaseConfig);
                  }}
                >
                  Sign in with {supabaseConfig.oauthProvider || 'GitHub'}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(STATUS_CONFIG).slice(1).map(([status, config]) => {
            const count = cumulativeNodes.filter(n => getNodeStatus(n.id) === status).length;
            const Icon = config.icon;
            return (
              <div key={status} className="flex items-center gap-2 text-xs">
                <Icon className={config.color} weight="fill" size={16} />
                <span className="text-muted-foreground">
                  {config.label}: {count}
                </span>
              </div>
            );
          })}
        </div>

        <ScrollArea className="h-[600px] pr-4">
          <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories}>
            {Object.entries(nodesByCategory).map(([category, nodes]) => {
              const subcategories = Array.from(new Set(nodes.map(n => n.subcategory)));
              
              return (
                <AccordionItem key={category} value={category}>
                  <AccordionTrigger className="text-left hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-2">
                      <span className="font-semibold text-sm uppercase tracking-wide">
                        {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]} ({nodes.length})
                      </span>
                      <Badge variant="outline" className="ml-2">
                        {nodes.filter(n => getNodeStatus(n.id) !== 'not-started').length}/{nodes.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                      {subcategories.map(subcategory => {
                        const subcatNodes = nodes.filter(n => n.subcategory === subcategory);
                        return (
                          <div key={subcategory} className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {subcategory}
                            </h4>
                            <div className="space-y-2">
                              {subcatNodes.map(node => {
                                const status = getNodeStatus(node.id);
                                const StatusIcon = STATUS_CONFIG[status].icon;
                                
                                return (
                                  <div
                                    key={node.id}
                                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors"
                                  >
                                    <StatusIcon
                                      className={`${STATUS_CONFIG[status].color} mt-0.5 flex-shrink-0`}
                                      weight={status === 'not-started' ? 'regular' : 'fill'}
                                      size={20}
                                    />
                                    <div className="flex-1 min-w-0 space-y-2">
                                      <div>
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex-1">
                                            <div className="font-mono text-xs text-muted-foreground mb-1">
                                              {node.id}
                                            </div>
                                            <h5 className="text-sm font-medium leading-tight">
                                              {node.title}
                                            </h5>
                                          </div>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                          Window: {node.windowStart.year}–{node.windowEnd.year}
                                        </div>
                                      </div>

                                      <Select
                                        value={status}
                                        onValueChange={(value) => updateNodeStatus(node.id, value as TechTreeStatus)}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {Object.entries(STATUS_CONFIG).map(([s, config]) => (
                                            <SelectItem key={s} value={s} className="text-xs">
                                              <div className="flex items-center gap-2">
                                                <config.icon className={config.color} size={14} weight="fill" />
                                                {config.label}
                                              </div>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>

                                      {node.dependsOn && node.dependsOn.length > 0 && (
                                        <div className="text-xs text-muted-foreground">
                                          <span className="font-semibold">Depends on:</span> {node.dependsOn.join(', ')}
                                        </div>
                                      )}

                                      <div className="flex flex-wrap gap-1">
                                        {node.tags.map(tag => (
                                          <Badge key={tag} variant="secondary" className="text-xs font-normal">
                                            {tag}
                                          </Badge>
                                        ))}
                                      </div>

                                      {node.indicators.length > 0 && (
                                        <details className="text-xs">
                                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                            Indicators ({node.indicators.length})
                                          </summary>
                                          <ul className="list-disc list-inside mt-1 space-y-0.5 text-muted-foreground">
                                            {node.indicators.map((indicator, idx) => (
                                              <li key={idx}>{indicator}</li>
                                            ))}
                                          </ul>
                                        </details>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </ScrollArea>
      </div>
    </Card>
  );
}
