import { useState, useMemo, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [isTouchUi, setIsTouchUi] = useState(false);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [drilldownPrediction, setDrilldownPrediction] = useState<Prediction | null>(null);
  const [drilldownGoal, setDrilldownGoal] = useState<Goal | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () => setIsTouchUi(mediaQuery.matches);
    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  const clearHoverPopup = () => {
    setHoveredPrediction(null);
    setHoveredGoal(null);
    setPopupPosition(null);
  };

  const openMobileDrilldown = ({ monthData, prediction, goal }: {
    monthData: MonthData;
    prediction?: Prediction;
    goal?: Goal;
  }) => {
    onMonthClick(monthData);
    setDrilldownPrediction(prediction || null);
    setDrilldownGoal(goal || null);
    setDrilldownOpen(true);
  };

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

  const getYearSummary = (year: number) => {
    const yearPredictions = filteredData
      .filter((monthData) => monthData.year === year)
      .flatMap((monthData) => monthData.predictions);
    const titles = Array.from(new Set(yearPredictions.map((prediction) => prediction.title)));
    return titles.length > 0
      ? `Predictions: ${titles.join(' • ')}`
      : 'No predictions available for the selected domains.';
  };

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

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
  const popupWidth = 320;
  const popupLeft = popupPosition
    ? Math.min(Math.max(popupPosition.x + 12, 12), viewportWidth - popupWidth - 12)
    : 12;
  const popupTop = popupPosition
    ? Math.min(Math.max(popupPosition.y - 180, 12), viewportHeight - 260)
    : 12;

  return (
    <div ref={containerRef} className="space-y-6 relative">
      {Array.from(groupedByYear.entries()).map(([year, months]) => {
        const highlights = getYearHighlights(year);
        const isExpanded = expandedYear === year;
        const yearGoals = goals.filter((g) => g.targetYear === year);
        const yearSummary = getYearSummary(year);

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
                          Year summary
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {yearSummary}
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
                                    role="button"
                                    tabIndex={0}
                                    className="flex items-start gap-2 p-3 rounded-lg bg-domain-individual/10 border border-domain-individual/30 hover:bg-domain-individual/15 transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isTouchUi) {
                                        openMobileDrilldown({ monthData, goal });
                                      }
                                    }}
                                    onMouseEnter={(e) => {
                                      if (isTouchUi) return;
                                      setHoveredGoal(goal);
                                      setHoveredPrediction(null);
                                      setPopupPosition({ x: e.clientX, y: e.clientY });
                                    }}
                                    onMouseMove={(e) => {
                                      if (isTouchUi) return;
                                      setPopupPosition({ x: e.clientX, y: e.clientY });
                                    }}
                                    onMouseLeave={() => {
                                      if (isTouchUi) return;
                                      clearHoverPopup();
                                    }}
                                    onKeyDown={(e) => {
                                      if ((e.key === 'Enter' || e.key === ' ') && isTouchUi) {
                                        e.preventDefault();
                                        openMobileDrilldown({ monthData, goal });
                                      }
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
                                  role="button"
                                  tabIndex={0}
                                  className="flex items-start gap-3 p-3 rounded-lg bg-background/40 hover:bg-background/60 transition-colors relative"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isTouchUi) {
                                      openMobileDrilldown({ monthData, prediction });
                                    }
                                  }}
                                  onMouseEnter={(e) => {
                                    if (isTouchUi) return;
                                    setHoveredPrediction(prediction);
                                    setHoveredGoal(null);
                                    setPopupPosition({ x: e.clientX, y: e.clientY });
                                  }}
                                  onMouseMove={(e) => {
                                    if (isTouchUi) return;
                                    setPopupPosition({ x: e.clientX, y: e.clientY });
                                  }}
                                  onMouseLeave={() => {
                                    if (isTouchUi) return;
                                    clearHoverPopup();
                                  }}
                                  onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ' ') && isTouchUi) {
                                      e.preventDefault();
                                      openMobileDrilldown({ monthData, prediction });
                                    }
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
      
      {!isTouchUi && (hoveredPrediction || hoveredGoal) && popupPosition && (
        <div
          className="fixed bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-2xl p-3 w-80 z-50 pointer-events-none"
          style={{
            left: `${popupLeft}px`,
            top: `${popupTop}px`,
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

      <Dialog
        open={drilldownOpen}
        onOpenChange={(open) => {
          setDrilldownOpen(open);
          if (!open) {
            setDrilldownPrediction(null);
            setDrilldownGoal(null);
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-none sm:max-w-xl max-h-[90dvh] overflow-hidden p-0 bg-card border-border">
          <DialogHeader className="px-4 pt-6 pb-3 border-b border-border/50">
            <DialogTitle className="text-lg font-semibold">
              {drilldownGoal ? 'Goal detail' : 'Prediction detail'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Mobile drill-down mode: tap sources to open full context.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90dvh-7.5rem)] px-4 py-4">
            {drilldownGoal && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded-lg bg-domain-individual/10 border border-domain-individual/30">
                  <Target
                    size={18}
                    weight="fill"
                    className="shrink-0 mt-0.5"
                    style={{ color: 'oklch(0.70 0.18 60)' }}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold">{drilldownGoal.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {drilldownGoal.description || 'No additional description provided.'}
                    </p>
                  </div>
                </div>

                {drilldownGoal.domains && drilldownGoal.domains.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Related domains</p>
                    <div className="flex flex-wrap gap-2">
                      {drilldownGoal.domains.map((domain) => (
                        <Badge
                          key={domain}
                          variant="outline"
                          className="text-xs"
                          style={{
                            borderColor: DOMAIN_COLORS[domain],
                            color: DOMAIN_COLORS[domain],
                          }}
                        >
                          {DOMAIN_LABELS[domain]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {drilldownPrediction && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg border border-border/50 bg-background/30">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-sm font-semibold leading-tight">{drilldownPrediction.title}</h3>
                    <Badge
                      variant={
                        drilldownPrediction.impact === 'high'
                          ? 'destructive'
                          : drilldownPrediction.impact === 'medium'
                          ? 'default'
                          : 'secondary'
                      }
                      className="text-xs"
                    >
                      {drilldownPrediction.impact}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {drilldownPrediction.description}
                  </p>

                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="font-mono font-bold" style={{ color: DOMAIN_COLORS[drilldownPrediction.domain] }}>
                      {DOMAIN_LABELS[drilldownPrediction.domain]}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-muted-foreground font-mono">
                      {(drilldownPrediction.probability * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                </div>

                {drilldownPrediction.sources && drilldownPrediction.sources.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      <Link size={12} />
                      Sources
                    </p>
                    <div className="space-y-2">
                      {drilldownPrediction.sources.map((source, idx) => (
                        <div key={idx} className="p-3 rounded-lg border border-border/50 bg-background/20">
                          {source.url ? (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline"
                            >
                              {source.name}
                            </a>
                          ) : (
                            <p className="text-sm">{source.name}</p>
                          )}
                          {source.confidence && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Confidence {(source.confidence * 100).toFixed(0)}%
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
