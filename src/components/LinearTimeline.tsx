import { useState, useMemo, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import type { Domain, MonthData, Goal, Prediction } from '@/lib/types';
import { DOMAIN_COLORS, DOMAIN_LABELS, getMonthName } from '@/lib/predictions';
import { Lightning, Target, TrendUp, Link } from '@phosphor-icons/react';

interface LinearTimelineProps {
  data: MonthData[];
  activeDomains: Domain[];
  onMonthClick: (monthData: MonthData) => void;
  goals: Goal[];
  selectedMonth: MonthData | null;
}

export function LinearTimeline({
  data,
  activeDomains,
  onMonthClick,
  goals,
  selectedMonth,
}: LinearTimelineProps) {
  const [expandedYear, setExpandedYear] = useState<number | null>(null);
  const [hoveredPrediction, setHoveredPrediction] = useState<Prediction | null>(null);
  const [hoveredGoal, setHoveredGoal] = useState<Goal | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const groupedByYear = useMemo(() => {
    const grouped = new Map<number, MonthData[]>();
    data.forEach((monthData) => {
      if (!grouped.has(monthData.year)) {
        grouped.set(monthData.year, []);
      }
      grouped.get(monthData.year)!.push(monthData);
    });
    return grouped;
  }, [data]);

  const filteredData = useMemo(() => {
    return data.map((monthData) => ({
      ...monthData,
      predictions: monthData.predictions.filter(
        (p) => activeDomains.length === 0 || activeDomains.includes(p.domain)
      ),
    }));
  }, [data, activeDomains]);

  const getYearHighlights = (year: number) => {
    const yearData = groupedByYear.get(year) || [];
    const allPredictions = yearData.flatMap((d) => d.predictions);
    const highImpact = allPredictions.filter((p) => p.impact === 'high');
    return {
      total: allPredictions.length,
      highImpact: highImpact.length,
      topPrediction: highImpact[0] || allPredictions[0],
    };
  };

  return (
    <div ref={containerRef} className="space-y-6 relative">
      {Array.from(groupedByYear.entries()).map(([year, months]) => {
        const highlights = getYearHighlights(year);
        const isExpanded = expandedYear === year;
        const yearGoals = goals.filter((g) => g.targetYear === year);

        return (
          <motion.div
            key={year}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card className="overflow-hidden bg-card/30 backdrop-blur-sm border-border/50">
              <div
                className="p-6 cursor-pointer hover:bg-card/50 transition-colors"
                onClick={() => setExpandedYear(isExpanded ? null : year)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4">
                      <h2 className="text-3xl font-bold font-mono text-primary">
                        {year}
                      </h2>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {highlights.total} events
                        </Badge>
                        {highlights.highImpact > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            <Lightning size={12} className="mr-1" weight="fill" />
                            {highlights.highImpact} high impact
                          </Badge>
                        )}
                        {yearGoals.length > 0 && (
                          <Badge className="text-xs bg-domain-individual text-primary-foreground">
                            <Target size={12} className="mr-1" weight="fill" />
                            {yearGoals.length} goal{yearGoals.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {highlights.topPrediction && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold text-foreground">
                          {highlights.topPrediction.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {highlights.topPrediction.description}
                        </p>
                      </div>
                    )}
                  </div>

                  <motion.div
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-muted-foreground"
                  >
                    <TrendUp size={24} />
                  </motion.div>
                </div>
              </div>

              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="border-t border-border/50"
                >
                  <div className="p-6 space-y-4">
                    {months.map((monthData) => {
                      const monthGoals = goals.filter(
                        (g) => g.targetYear === monthData.year && g.targetMonth === monthData.month
                      );
                      const monthPredictions = filteredData.find(
                        (d) => d.year === monthData.year && d.month === monthData.month
                      )?.predictions || [];

                      if (monthPredictions.length === 0 && monthGoals.length === 0) {
                        return null;
                      }

                      const isSelected =
                        selectedMonth?.year === monthData.year &&
                        selectedMonth?.month === monthData.month;

                      return (
                        <div
                          key={`${monthData.year}-${monthData.month}`}
                          className={`
                            pl-6 border-l-2 transition-all cursor-pointer
                            ${
                              isSelected
                                ? 'border-primary bg-primary/5' 
                                : 'border-border hover:border-primary/50 hover:bg-card/20'
                            }
                          `}
                          onClick={() => onMonthClick(monthData)}
                        >
                          <div className="pb-4">
                            <div className="flex items-center gap-3 mb-3">
                              <h3 className="text-lg font-semibold font-mono text-primary">
                                {getMonthName(monthData.month)} {monthData.year}
                              </h3>
                              <div className="flex-1 h-px bg-border/30" />
                            </div>

                            {monthGoals.length > 0 && (
                              <div className="mb-3 space-y-2">
                                {monthGoals.map((goal) => (
                                  <div
                                    key={goal.id}
                                    className="flex items-start gap-2 p-3 rounded-lg bg-domain-individual/10 border border-domain-individual/30"
                                    onMouseEnter={(e) => {
                                      setHoveredGoal(goal);
                                      setHoveredPrediction(null);
                                      if (containerRef.current) {
                                        const containerRect = containerRef.current.getBoundingClientRect();
                                        const hoverX = e.clientX - containerRect.left;
                                        const hoverY = e.clientY - containerRect.top;
                                        setPopupPosition({ x: hoverX, y: hoverY });
                                      }
                                    }}
                                    onMouseLeave={() => {
                                      setHoveredGoal(null);
                                      setPopupPosition(null);
                                    }}
                                  >
                                    <Target
                                      size={16}
                                      weight="fill"
                                      className="text-domain-individual mt-0.5 shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-foreground">
                                        {goal.title}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="space-y-2">
                              {monthPredictions.map((prediction) => (
                                <div
                                  key={prediction.id}
                                  className="flex items-start gap-3 p-3 rounded-lg bg-background/40 hover:bg-background/60 transition-colors relative"
                                  onMouseEnter={(e) => {
                                    setHoveredPrediction(prediction);
                                    setHoveredGoal(null);
                                    if (containerRef.current) {
                                      const containerRect = containerRef.current.getBoundingClientRect();
                                      const hoverX = e.clientX - containerRect.left;
                                      const hoverY = e.clientY - containerRect.top;
                                      setPopupPosition({ x: hoverX, y: hoverY });
                                    }
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPrediction(null);
                                    setPopupPosition(null);
                                  }}
                                >
                                  <div
                                    className="w-1 h-full rounded-full shrink-0 mt-1"
                                    style={{ backgroundColor: DOMAIN_COLORS[prediction.domain] }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                      <p className="text-sm font-semibold text-foreground">
                                        {prediction.title}
                                      </p>
                                      <Badge
                                        variant={
                                          prediction.impact === 'high'
                                            ? 'destructive'
                                            : prediction.impact === 'medium'
                                            ? 'default'
                                            : 'secondary'
                                        }
                                        className="shrink-0 text-xs"
                                      >
                                        {prediction.impact}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      <span
                                        className="font-mono font-bold"
                                        style={{ color: DOMAIN_COLORS[prediction.domain] }}
                                      >
                                        {DOMAIN_LABELS[prediction.domain]}
                                      </span>
                                      <span className="text-muted-foreground">•</span>
                                      <span className="text-muted-foreground font-mono">
                                        {(prediction.probability * 100).toFixed(0)}% confidence
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </Card>
          </motion.div>
        );
      })}
      
      {(hoveredPrediction || hoveredGoal) && popupPosition && (
        <div
          className="fixed bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-2xl p-3 w-80 z-50 pointer-events-none"
          style={{
            left: `${popupPosition.x + 10}px`,
            top: `${popupPosition.y - 150}px`,
          }}
        >
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-primary uppercase tracking-wide">
              {hoveredGoal ? 'Goal' : 'Prediction'}
            </h3>
            
            {hoveredGoal && (
              <div className="flex items-start gap-2 p-2 rounded bg-background/40">
                <Target
                  size={14}
                  weight="fill"
                  className="shrink-0 mt-0.5"
                  style={{ color: 'oklch(0.70 0.18 60)' }}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-semibold text-foreground">
                    {hoveredGoal.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {hoveredGoal.description}
                  </p>
                  {hoveredGoal.domains && hoveredGoal.domains.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {hoveredGoal.domains.map((domain) => (
                        <Badge
                          key={domain}
                          variant="outline"
                          className="text-[9px] px-1.5 py-0"
                          style={{
                            borderColor: DOMAIN_COLORS[domain],
                            color: DOMAIN_COLORS[domain],
                          }}
                        >
                          {DOMAIN_LABELS[domain]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {hoveredPrediction && (
              <div className="flex items-start gap-2 p-2 rounded bg-background/40">
                <div
                  className="w-1 h-full shrink-0 rounded"
                  style={{ backgroundColor: DOMAIN_COLORS[hoveredPrediction.domain] }}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      {hoveredPrediction.title}
                    </p>
                    <Badge
                      variant={
                        hoveredPrediction.impact === 'high'
                          ? 'destructive'
                          : hoveredPrediction.impact === 'medium'
                          ? 'default'
                          : 'secondary'
                      }
                      className="text-[10px] shrink-0"
                    >
                      {hoveredPrediction.impact}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {hoveredPrediction.description}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className="font-mono font-bold"
                      style={{ color: DOMAIN_COLORS[hoveredPrediction.domain] }}
                    >
                      {DOMAIN_LABELS[hoveredPrediction.domain]}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground font-mono">
                      {(hoveredPrediction.probability * 100).toFixed(0)}%
                    </span>
                  </div>
                  {hoveredPrediction.sources && hoveredPrediction.sources.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      <div className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                        <Link size={10} />
                        Sources:
                      </div>
                      {hoveredPrediction.sources.map((source, idx) => (
                        <div key={idx} className="ml-3">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-primary hover:underline pointer-events-auto"
                          >
                            {source.name}
                          </a>
                          {source.confidence && (
                            <span className="text-[10px] text-muted-foreground">
                              {' '}({(source.confidence * 100).toFixed(0)}%)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
