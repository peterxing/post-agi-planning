import { useMemo } from 'react';
import type { TechTreeStatus, MonthData } from '@/lib/types';
import { getAutoTechTreeStatusesForDate, getCumulativeTechNodes } from '@/lib/tech-tree';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Lightning, User } from '@phosphor-icons/react';

interface SummaryContext {
  monthLabel: string;
  activeNodes: ReturnType<typeof getCumulativeTechNodes>;
  activeNodesList: string;
  topImpactsList: string;
  predictionsList: string;
}

const buildAutoSummary = (context: SummaryContext) => {
  const { monthLabel, activeNodes, activeNodesList, topImpactsList, predictionsList } = context;

  const notableTech = activeNodes.slice(0, 3).map(node => node.title).join(', ') || 'subtle background systems';
  const focusAreas = topImpactsList || 'everyday routines and work patterns';

  const predictionLine = predictionsList
    ? `The month's headlines orbit predictions like ${predictionsList.replace(/^- /gm, '').split('\n').join(', ')}.`
    : 'Headlines are a mix of incremental improvements and cautious optimism.';

  const techLine = activeNodesList
    ? `Technologies such as ${notableTech} quietly hum in the background, stitched together by steady deployment teams.`
    : `Even without a single headline technology, your devices quietly coordinate the day in ways that would have felt uncanny a few years ago.`;

  return [
    `It's ${monthLabel}, and your day is quietly shaped by ${notableTech}. You wake to a home that already knows your schedule, adjusts the lights, and queues up a breakfast that matches your health preferences. Commuting is less stressful as automation handles most logistics, letting you reclaim mental space for reflection.`,
    `Work has become a conversation with systems rather than a grind through interfaces. Agents prepare briefs and drafts, leaving you to edit and steer. Collaboration happens asynchronously with teammates and their tools, and the biggest change is how quickly ideas turn into tested pilots. The focus areas that feel most different are ${focusAreas}.`,
    `Social life keeps pace with the technology curve. Some interactions feel hyper-mediated, but there is still novelty in the way gatherings blend physical and digital presence. ${predictionLine} ${techLine} The month feels like a waypoint rather than a destination.`,
  ].join('\n\n');
};

interface LivedExperienceSummaryProps {
  monthData: MonthData | null;
}

export function LivedExperienceSummary({ monthData }: LivedExperienceSummaryProps) {
  const computed = useMemo(() => {
    if (!monthData) return null;

    const cumulativeNodes = getCumulativeTechNodes(monthData.year, monthData.month);
    const autoStatuses = getAutoTechTreeStatusesForDate(monthData.year, monthData.month);

    const activeNodes = cumulativeNodes.filter(node => {
      const status = autoStatuses[node.id] || 'not-started';
      return status !== 'not-started' && status !== 'r-and-d';
    });

    const lifeVariableImpacts = new Map<string, number>();
    activeNodes.forEach(node => {
      node.tags.forEach(tag => {
        lifeVariableImpacts.set(tag, (lifeVariableImpacts.get(tag) || 0) + 1);
      });
    });

    const topImpacts = Array.from(lifeVariableImpacts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    const statusBreakdown = activeNodes.reduce((acc, node) => {
      const status = autoStatuses[node.id] || 'not-started';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<TechTreeStatus, number>);

    const monthLabel = new Date(monthData.year, monthData.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const activeNodesList = activeNodes
      .slice(0, 20)
      .map(n => `- ${n.title} (${autoStatuses[n.id] || 'not-started'})`)
      .join('\n');
    const topImpactsList = topImpacts.join(', ');
    const predictionsList = monthData.predictions.slice(0, 3).map(p => `- ${p.title}`).join('\n');

    const summary = buildAutoSummary({
      monthLabel,
      activeNodes,
      activeNodesList,
      topImpactsList,
      predictionsList,
    });

    return {
      monthLabel,
      summary,
      activeCount: activeNodes.length,
      totalCount: cumulativeNodes.length,
      statusBreakdown,
    };
  }, [monthData]);

  if (!monthData || !computed) {
    return (
      <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
        <div className="text-center text-muted-foreground py-8">
          <User size={48} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select a month to view the auto-populated lived experience summary</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Lived Experience</h3>
            <p className="text-xs text-muted-foreground">{computed.monthLabel}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <Lightning size={12} /> Auto-populated
            </Badge>
            <Badge variant="outline" className="text-xs">
              {computed.activeCount}/{computed.totalCount} active nodes
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(computed.statusBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([status, count]) => (
              <Badge key={status} variant="outline">
                {status}: {count}
              </Badge>
            ))}
        </div>

        <ScrollArea className="h-[400px] pr-4">
          <div className="prose prose-sm prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {computed.summary}
            </div>
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
