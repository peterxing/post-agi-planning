import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { MonthData, Domain } from '@/lib/types';
import { getMonthName, DOMAIN_LABELS } from '@/lib/predictions';
import { Brain, ArrowsClockwise } from '@phosphor-icons/react';

interface NarrativeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monthData: MonthData | null;
  activeDomains: Domain[];
}

export function NarrativeDialog({
  open,
  onOpenChange,
  monthData,
  activeDomains,
}: NarrativeDialogProps) {
  const [narrative, setNarrative] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (open && monthData) {
      generateNarrative();
    }
  }, [open, monthData]);

  const generateNarrative = async () => {
    if (!monthData) return;

    setIsGenerating(true);

    try {
      const relevantPredictions = monthData.predictions.filter(
        (p) => activeDomains.length === 0 || activeDomains.includes(p.domain)
      );

      const predictionContext = relevantPredictions
        .map((p) => `${DOMAIN_LABELS[p.domain]}: ${p.title} (${(p.probability * 100).toFixed(0)}% probability) - ${p.description}`)
        .join('\n');

      const domainContext = activeDomains.length > 0
        ? `Focus particularly on: ${activeDomains.map((d) => DOMAIN_LABELS[d]).join(', ')}`
        : 'Consider all domains of civilization';

      const monthName = getMonthName(monthData.month);
      const year = monthData.year;

      const promptText = `You are a future anthropologist describing the lived experience in ${monthName} ${year}.

Based on these forecasts:
${predictionContext}

${domainContext}

Write a vivid 2-3 paragraph narrative describing what daily life might feel like in this month. Include:
- The ambient mood and social atmosphere
- How technology is integrated into daily routines
- Economic realities people face
- Social and political dynamics
- Individual concerns and aspirations

Make it personal, sensory, and grounded. Avoid generic statements. This should read like a dispatch from the future.`;

      const result = await window.spark.llm(promptText, 'gpt-4o');
      setNarrative(result);
    } catch (error) {
      setNarrative('Unable to generate narrative. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Brain weight="duotone" className="text-primary" />
            Lived Experience Simulation
          </DialogTitle>
          <DialogDescription>
            A glimpse into{' '}
            <span className="font-mono text-primary font-semibold">
              {monthData ? `${getMonthName(monthData.month)} ${monthData.year}` : '...'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px] pr-4">
          {isGenerating ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center space-y-3">
                <div className="animate-spin">
                  <Brain size={48} className="text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Simulating future conditions...
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="prose prose-sm prose-invert max-w-none">
                {narrative.split('\n\n').map((paragraph, i) => (
                  <p key={i} className="text-foreground leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}
        </ScrollArea>

        {!isGenerating && narrative && (
          <div className="flex justify-end gap-2 pt-4 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={generateNarrative}
              disabled={isGenerating}
            >
              <ArrowsClockwise className="mr-2" />
              Regenerate
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
