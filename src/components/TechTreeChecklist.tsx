import { useMemo, useState } from 'react';
import type { TechTreeNode, TechTreeStatus } from '@/lib/types';
import { getAutoTechTreeStatusesForDate, getCumulativeTechNodes } from '@/lib/tech-tree';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Circle, Flask, Users, Rocket, Globe, Lock, Lightning } from '@phosphor-icons/react';

interface TechTreeChecklistProps {
  year: number;
  month: number;
}

const STATUS_CONFIG: Record<TechTreeStatus, { label: string; icon: typeof Circle; color: string }> = {
  'not-started': { label: 'Not Started', icon: Circle, color: 'text-muted-foreground' },
  'r-and-d': { label: 'R&D', icon: Flask, color: 'text-blue-400' },
  pilot: { label: 'Pilot', icon: Users, color: 'text-purple-400' },
  'early-adopters': { label: 'Early Adopters', icon: Rocket, color: 'text-yellow-400' },
  'mass-market': { label: 'Mass Market', icon: Globe, color: 'text-green-400' },
  ubiquitous: { label: 'Ubiquitous', icon: CheckCircle, color: 'text-primary' },
  regulated: { label: 'Regulated', icon: Lock, color: 'text-destructive' },
};

const CATEGORY_LABELS = {
  individual: 'Individual',
  society: 'Society',
  economy: 'Economy',
  governance: 'Governance',
  geopolitics: 'Geopolitics',
};

export function TechTreeChecklist({ year, month }: TechTreeChecklistProps) {
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['individual']);

  const cumulativeNodes = useMemo(() => getCumulativeTechNodes(year, month), [year, month]);
  const autoStatuses = useMemo(() => getAutoTechTreeStatusesForDate(year, month), [year, month]);

  const nodesByCategory = useMemo(() => {
    return cumulativeNodes.reduce((acc, node) => {
      if (!acc[node.category]) acc[node.category] = [];
      acc[node.category].push(node);
      return acc;
    }, {} as Record<string, TechTreeNode[]>);
  }, [cumulativeNodes]);

  const getNodeStatus = (nodeId: string): TechTreeStatus => autoStatuses[nodeId] || 'not-started';

  const stats = useMemo(() => {
    const total = cumulativeNodes.length;
    const statuses = cumulativeNodes.map((node) => getNodeStatus(node.id));
    const notStarted = statuses.filter((status) => status === 'not-started').length;
    const active = total - notStarted;
    return {
      total,
      active,
      percentage: total > 0 ? Math.round((active / total) * 100) : 0,
    };
  }, [cumulativeNodes, autoStatuses]);

  return (
    <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Tech Tree Checklist</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-populated through {new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-primary">{stats.percentage}%</div>
            <div className="text-xs text-muted-foreground">{stats.active} of {stats.total} active</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Lightning size={14} className="text-primary" />
            Auto mode enabled
          </div>
          <div className="text-muted-foreground">
            Statuses are inferred from timeline windows + dependency chains (read-only).
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(STATUS_CONFIG).slice(1).map(([status, config]) => {
            const count = cumulativeNodes.filter((node) => getNodeStatus(node.id) === status).length;
            const Icon = config.icon;
            return (
              <div key={status} className="flex items-center gap-2 text-xs">
                <Icon className={config.color} weight="fill" size={16} />
                <span className="text-muted-foreground">{config.label}: {count}</span>
              </div>
            );
          })}
        </div>

        <ScrollArea className="h-[600px] pr-4">
          <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories}>
            {Object.entries(nodesByCategory).map(([category, nodes]) => {
              const subcategories = Array.from(new Set(nodes.map((node) => node.subcategory)));

              return (
                <AccordionItem key={category} value={category}>
                  <AccordionTrigger className="text-left hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-2">
                      <span className="font-semibold text-sm uppercase tracking-wide">
                        {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]} ({nodes.length})
                      </span>
                      <Badge variant="outline" className="ml-2">
                        {nodes.filter((node) => getNodeStatus(node.id) !== 'not-started').length}/{nodes.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pt-2">
                      {subcategories.map((subcategory) => {
                        const subcatNodes = nodes.filter((node) => node.subcategory === subcategory);

                        return (
                          <div key={subcategory} className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {subcategory}
                            </h4>

                            <div className="space-y-2">
                              {subcatNodes.map((node) => {
                                const status = getNodeStatus(node.id);
                                const StatusIcon = STATUS_CONFIG[status].icon;

                                return (
                                  <div
                                    key={node.id}
                                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
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
                                            <div className="font-mono text-xs text-muted-foreground mb-1">{node.id}</div>
                                            <h5 className="text-sm font-medium leading-tight">{node.title}</h5>
                                          </div>
                                          <Badge variant="secondary" className="text-xs shrink-0">
                                            {STATUS_CONFIG[status].label}
                                          </Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                          Window: {node.windowStart.year}–{node.windowEnd.year}
                                        </div>
                                      </div>

                                      {node.dependsOn && node.dependsOn.length > 0 && (
                                        <div className="text-xs text-muted-foreground">
                                          <span className="font-semibold">Depends on:</span> {node.dependsOn.join(', ')}
                                        </div>
                                      )}

                                      <div className="flex flex-wrap gap-1">
                                        {node.tags.map((tag) => (
                                          <Badge key={tag} variant="outline" className="text-xs font-normal">
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
