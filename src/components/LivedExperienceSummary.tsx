import { useEffect, useState } from 'react';
import { useKV } from '@github/spark/hooks';
import type { TechTreeState, TechTreeStatus, MonthData } from '@/lib/types';
import { getCumulativeTechNodes, getNodeStatusForDate } from '@/lib/tech-tree';
import { generateSparkText } from '@/lib/spark-llm';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkle, User } from '@phosphor-icons/react';
import { toast } from 'sonner';

interface SummaryContext {
  monthLabel: string;
  activeNodes: ReturnType<typeof getCumulativeTechNodes>;
  activeNodesList: string;
  statusList: string;
  topImpactsList: string;
  predictionsList: string;
}

const buildFallbackSummary = (context: SummaryContext) => {
  const { monthLabel, activeNodes, activeNodesList, topImpactsList, predictionsList } = context;

  const notableTech = activeNodes.slice(0, 3).map(node => node.title).join(', ') || 'subtle background systems';
  const focusAreas = topImpactsList || 'everyday routines and work patterns';

  const predictionLine = predictionsList
    ? `The month's headlines orbit predictions like ${predictionsList.replace(/^- /gm, '').split('\n').join(', ')}.`
    : 'Headlines are a mix of incremental improvements and cautious optimism.';

  const techLine = activeNodesList
    ? `Technologies such as ${notableTech} quietly hum in the background, stitched together by steady deployment teams.`
    : `Even without a single headline technology, your devices quietly coordinate the day in ways that would have felt uncanny a few years ago.`;
  const headlinePredictions = predictionsList || 'incremental signals rather than headline breakthroughs';

  return [
    `It's ${monthLabel}, and your day is quietly shaped by ${notableTech}. You wake to a home that already knows your schedule, adjusts the lights, and queues up a breakfast that matches your health preferences. Commuting is less stressful as automation handles most logistics, letting you reclaim mental space for reflection.`,
    `Work has become a conversation with systems rather than a grind through interfaces. Agents prepare briefs and drafts, leaving you to edit and steer. Collaboration happens asynchronously with teammates and their tools, and the biggest change is how quickly ideas turn into tested pilots. The focus areas that feel most different are ${focusAreas}.`,
    `Social life keeps pace with the technology curve. Some interactions feel hyper-mediated, but there is still novelty in the way gatherings blend physical and digital presence. ${predictionLine} ${techLine} The month feels like a waypoint rather than a destination.`,
    `Social life keeps pace with the technology curve. Some interactions feel hyper-mediated, but there is still novelty in the way gatherings blend physical and digital presence. Headlines for the month point toward ${headlinePredictions}, reminding you that the present is a moving target.`,
  ].join('\n\n');
};

interface LivedExperienceSummaryProps {
  monthData: MonthData | null;
}

export function LivedExperienceSummary({ monthData }: LivedExperienceSummaryProps) {
  const [techStates] = useKV<TechTreeState[]>('tech-tree-states', []);
  const [summary, setSummary] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    setSummary('');
  }, [monthData?.month, monthData?.year]);

  if (!monthData) {
    return (
      <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
        <div className="text-center text-muted-foreground py-8">
          <User size={48} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select a month to generate a lived experience summary</p>
        </div>
      </Card>
    );
  }

  const generateSummary = async () => {
    setIsGenerating(true);
    setSummary('');

    const cumulativeNodes = getCumulativeTechNodes(monthData.year, monthData.month);

    const activeNodes = cumulativeNodes.filter(node => {
      const status = getNodeStatusForDate(techStates, node.id, monthData.year, monthData.month, 'pilot');
      const state = techStates?.find(s => s.nodeId === node.id);
      const status = state?.status || 'not-started';
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
      const status = getNodeStatusForDate(techStates, node.id, monthData.year, monthData.month, 'pilot');
      const state = techStates?.find(s => s.nodeId === node.id);
      const status = state?.status || 'not-started';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<TechTreeStatus, number>);

    const monthLabel = new Date(monthData.year, monthData.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const activeNodesList = activeNodes
      .slice(0, 20)
      .map(n => `- ${n.title} (${getNodeStatusForDate(techStates, n.id, monthData.year, monthData.month, 'pilot')})`)
      .join('\n');
    const activeNodesList = activeNodes.slice(0, 20).map(n => `- ${n.title} (${techStates?.find(s => s.nodeId === n.id)?.status || 'pilot'})`).join('\n');
    const statusList = Object.entries(statusBreakdown).map(([status, count]) => `- ${status}: ${count} breakthroughs`).join('\n');
    const topImpactsList = topImpacts.join(', ');
    const predictionsList = monthData.predictions.slice(0, 3).map(p => `- ${p.title}`).join('\n');

    const context: SummaryContext = {
      monthLabel,
      activeNodes,
      activeNodesList,
      statusList,
      topImpactsList,
      predictionsList,
    };

    try {
      const promptText = `You are a futurist writing a vivid "lived experience" narrative for someone living in ${monthLabel}.

Based on the following technological breakthroughs that have occurred or are underway, write a compelling 3-4 paragraph narrative describing what daily life is like for an average person in a developed country.

Active Technology Nodes (${activeNodes.length} total):
${activeNodesList}

Status Breakdown:
${statusList}

Most Affected Life Areas:
${topImpactsList}

Key Predictions for this Month:
${predictionsList}

Write in second person ("you wake up...", "your morning starts...") and make it concrete and sensory. Focus on:
1. How the morning routine has changed
2. How work/productivity has evolved
3. How social life and relationships have shifted
4. What feels normal vs what still feels novel

Be specific about technologies in use but keep the tone human and relatable. Aim for 300-400 words.`;

      const aiSummary = await generateSparkText(promptText, 'gpt-4o');
      const aiSummary = await window.spark?.llm?.(promptText, 'gpt-4o');

      if (aiSummary) {
        setSummary(aiSummary);
        toast.success('Lived experience summary generated');
      } else {
        const fallback = buildFallbackSummary(context);
        setSummary(fallback);
        toast.warning('Using offline summary while AI is unavailable');
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      const fallback = buildFallbackSummary(context);
      setSummary(fallback);
      toast.error('Failed to generate summary with AI. Showing synthesized version instead');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Lived Experience</h3>
            <p className="text-xs text-muted-foreground">
              {new Date(monthData.year, monthData.month).toLocaleDateString('en-US', { 
                month: 'long', 
                year: 'numeric' 
              })}
            </p>
          </div>
          <Button
            onClick={generateSummary}
            disabled={isGenerating}
            size="sm"
            className="gap-2"
          >
            <Sparkle weight="fill" />
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>

        {summary ? (
          <ScrollArea className="h-[400px] pr-4">
            <div className="prose prose-sm prose-invert max-w-none">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {summary}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkle size={40} className="mx-auto mb-3 opacity-50" weight="duotone" />
            <p className="text-sm">
              Generate an AI-powered narrative of daily life
              <br />
              based on active tech tree breakthroughs
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
