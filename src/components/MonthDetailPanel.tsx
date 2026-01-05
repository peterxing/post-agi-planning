import type { MonthData, Domain, Prediction } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { getMonthName, DOMAIN_LABELS, DOMAIN_COLORS } from '@/lib/predictions';
import { TrendUp, TrendDown, Eye, Target, Link } from '@phosphor-icons/react';
import { useState } from 'react';

interface MonthDetailPanelProps {
  monthData: MonthData | null;
  selectedPrediction: Prediction | null;
  activeDomains: Domain[];
  onGenerateNarrative: () => void;
  onCreateGoal: () => void;
}

export function MonthDetailPanel({
  monthData,
  selectedPrediction,
  activeDomains,
  onGenerateNarrative,
  onCreateGoal,
}: MonthDetailPanelProps) {
  if (!monthData) {
    return (
      <Card className="p-6 h-full bg-card/50 backdrop-blur-sm border-border/50">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center space-y-2">
            <Eye size={48} className="mx-auto opacity-50" />
            <p className="text-sm">Select a month to view predictions</p>
          </div>
        </div>
      </Card>
    );
  }

  const relevantPredictions = selectedPrediction 
    ? [selectedPrediction]
    : monthData.predictions.filter(
        (p) => activeDomains.length === 0 || activeDomains.includes(p.domain)
      );

  return (
    <Card className="p-6 h-full bg-card/50 backdrop-blur-sm border-border/50 flex flex-col">
      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-bold text-primary font-mono tracking-tight">
            {getMonthName(monthData.month)} {monthData.year}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedPrediction 
              ? 'Selected prediction'
              : `${relevantPredictions.length} active prediction${relevantPredictions.length !== 1 ? 's' : ''}`
            }
          </p>
        </div>

        {!selectedPrediction && (
          <>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={onGenerateNarrative}
                className="flex-1"
              >
                <Eye className="mr-2" />
                Lived Experience
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCreateGoal}
                className="flex-1"
              >
                <Target className="mr-2" />
                Add Goal
              </Button>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              {Object.entries(monthData.probabilities).map(([domain, prob]) => {
                if (activeDomains.length > 0 && !activeDomains.includes(domain as Domain)) {
                  return null;
                }

                const percentage = (prob * 100).toFixed(0);
                const trend = prob > 0.6 ? 'up' : 'down';

                return (
                  <div
                    key={domain}
                    className="p-3 rounded-lg border border-border/50 bg-background/30"
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        {DOMAIN_LABELS[domain as Domain]}
                      </span>
                      {trend === 'up' ? (
                        <TrendUp size={14} className="text-domain-tech" />
                      ) : (
                        <TrendDown size={14} className="text-domain-geopolitical" />
                      )}
                    </div>
                    <div className="font-mono text-xl font-bold" style={{ color: `var(--domain-${domain})` }}>
                      {percentage}%
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <Separator />
      </div>

      <ScrollArea className="flex-1 mt-4 -mx-2 px-2">
        <div className="space-y-3">
          {relevantPredictions.map((prediction) => (
            <div
              key={prediction.id}
              className="p-4 rounded-lg border border-border/50 bg-background/20 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-sm leading-tight">
                  {prediction.title}
                </h4>
                <Badge
                  variant={prediction.impact === 'high' ? 'destructive' : 'secondary'}
                  className="shrink-0 text-xs"
                >
                  {prediction.impact}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {prediction.description}
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-mono font-bold"
                    style={{ color: DOMAIN_COLORS[prediction.domain] }}
                  >
                    {(prediction.probability * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {DOMAIN_LABELS[prediction.domain]}
                  </span>
                </div>
              </div>
              {prediction.sources && prediction.sources.length > 0 && (
                <div className="pt-2 space-y-1">
                  <div className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Link size={12} />
                    Sources:
                  </div>
                  <div className="space-y-1">
                    {prediction.sources.map((source, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        {source.url ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {source.name}
                            {source.confidence && (
                              <span className="text-muted-foreground">
                                ({(source.confidence * 100).toFixed(0)}%)
                              </span>
                            )}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {source.name}
                            {source.confidence && (
                              <span> ({(source.confidence * 100).toFixed(0)}%)</span>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {relevantPredictions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No predictions match selected domains
            </div>
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
