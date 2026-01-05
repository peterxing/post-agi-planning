import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import type { Domain, MonthData, Goal, Prediction } from '@/lib/types';
import { DOMAIN_COLORS, DOMAIN_LABELS, getMonthName } from '@/lib/predictions';
import { Badge } from '@/components/ui/badge';
import { Target, Link } from '@phosphor-icons/react';

interface CircularTimelineProps {
  data: MonthData[];
  activeDomains: Domain[];
  onMonthClick: (monthData: MonthData) => void;
  onMonthHover: (monthData: MonthData | null) => void;
  onPredictionSelect: (prediction: Prediction | null) => void;
  goals: Goal[];
  selectedMonth: MonthData | null;
}

export function CircularTimeline({
  data,
  activeDomains,
  onMonthClick,
  onMonthHover,
  onPredictionSelect,
  goals,
  selectedMonth,
}: CircularTimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredPrediction, setHoveredPrediction] = useState<Prediction | null>(null);
  const [hoveredGoal, setHoveredGoal] = useState<Goal | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);

  const filteredData = useMemo(() => {
    return data.map((monthData) => ({
      ...monthData,
      predictions: monthData.predictions.filter(
        (p) => activeDomains.length === 0 || activeDomains.includes(p.domain)
      ),
    }));
  }, [data, activeDomains]);

  useEffect(() => {
    setHoveredPrediction(null);
    setHoveredGoal(null);
    setPopupPosition(null);
  }, [selectedMonth, activeDomains]);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = 800;
    const height = 800;
    const centerX = width / 2;
    const centerY = height / 2;
    const innerRadius = 80;
    const minDotRadius = 150;
    const maxDotRadius = 340;
    const yearLabelRadius = 380;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    svg.on('click', function (event) {
      if (event.target === this) {
        setHoveredPrediction(null);
        setHoveredGoal(null);
        setPopupPosition(null);
        onPredictionSelect(null);
      }
    });

    const mainGroup = svg.append('g').attr('transform', `translate(${centerX}, ${centerY})`);

    const angleScale = d3
      .scaleLinear()
      .domain([0, data.length])
      .range([0, 2 * Math.PI]);

    mainGroup
      .append('circle')
      .attr('r', innerRadius)
      .attr('fill', 'oklch(0.20 0.03 250)')
      .attr('stroke', 'oklch(0.75 0.15 200)')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8);

    const segments = mainGroup
      .selectAll('.segment')
      .data(filteredData)
      .enter()
      .append('g')
      .attr('class', 'segment');

    const yearPositions = new Map<number, number>();
    filteredData.forEach((d, i) => {
      if (!yearPositions.has(d.year)) {
        yearPositions.set(d.year, i);
      }
    });

    yearPositions.forEach((index, year) => {
      const monthOffset = 12;
      const angle = angleScale(index + monthOffset + 0.5) - Math.PI / 2;
      const labelX = Math.cos(angle) * yearLabelRadius;
      const labelY = Math.sin(angle) * yearLabelRadius;

      mainGroup
        .append('text')
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', 'oklch(0.75 0.15 200)')
        .attr('font-size', '18px')
        .attr('font-family', 'Space Grotesk, sans-serif')
        .attr('font-weight', '700')
        .attr('opacity', 0.9)
        .text(year);
    });

    segments.each(function (d, i) {
      const segment = d3.select(this);
      const monthOffset = 12;
      const startAngle = angleScale(i + monthOffset) - Math.PI / 2;
      const endAngle = angleScale(i + monthOffset + 1) - Math.PI / 2;
      const midAngle = (startAngle + endAngle) / 2;

      d.predictions.forEach((prediction) => {
        const dotRadius = minDotRadius + (maxDotRadius - minDotRadius) * prediction.probability;
        const dotX = Math.cos(midAngle) * dotRadius;
        const dotY = Math.sin(midAngle) * dotRadius;

        segment
          .append('line')
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', dotX)
          .attr('y2', dotY)
          .attr('stroke', DOMAIN_COLORS[prediction.domain])
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.3)
          .attr('pointer-events', 'none');

        segment
          .append('circle')
          .attr('cx', dotX)
          .attr('cy', dotY)
          .attr('r', 5)
          .attr('fill', DOMAIN_COLORS[prediction.domain])
          .attr('stroke', 'oklch(0.98 0 0)')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.95)
          .style('filter', `drop-shadow(0 0 6px ${DOMAIN_COLORS[prediction.domain]})`)
          .style('cursor', 'pointer')
          .on('mouseenter', function (event) {
            d3.select(this)
              .attr('r', 7)
              .attr('stroke-width', 2)
              .attr('opacity', 1);
            
            setHoveredPrediction(prediction);
            setHoveredGoal(null);
            if (svgRef.current && containerRef.current) {
              const containerRect = containerRef.current.getBoundingClientRect();
              const hoverX = event.clientX - containerRect.left;
              const hoverY = event.clientY - containerRect.top;
              setPopupPosition({ x: hoverX, y: hoverY });
            }
          })
          .on('mouseleave', function () {
            d3.select(this)
              .attr('r', 5)
              .attr('stroke-width', 1.5)
              .attr('opacity', 0.95);
            
            setHoveredPrediction(null);
            setPopupPosition(null);
          })
          .on('click', function () {
            onMonthClick(d);
            onPredictionSelect(prediction);
          });
      });

      const monthGoals = goals.filter((goal) => {
        const goalDate = new Date(goal.targetYear, goal.targetMonth - 1);
        return goalDate.getFullYear() === d.year && goalDate.getMonth() + 1 === d.month;
      });

      monthGoals.forEach((goal, goalIndex) => {
        const markerRadius = maxDotRadius + 20 + (goalIndex * 15);
        const markerX = Math.cos(midAngle) * markerRadius;
        const markerY = Math.sin(midAngle) * markerRadius;

        segment
          .append('line')
          .attr('x1', 0)
          .attr('y1', 0)
          .attr('x2', markerX)
          .attr('y2', markerY)
          .attr('stroke', 'oklch(0.70 0.18 60)')
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.3)
          .attr('pointer-events', 'none');

        segment
          .append('circle')
          .attr('cx', markerX)
          .attr('cy', markerY)
          .attr('r', 7)
          .attr('fill', 'oklch(0.70 0.18 60)')
          .attr('stroke', 'oklch(0.98 0 0)')
          .attr('stroke-width', 2)
          .attr('opacity', 0.95)
          .style('cursor', 'pointer')
          .on('mouseenter', function (event) {
            d3.select(this)
              .attr('r', 9)
              .attr('stroke-width', 3);
            
            setHoveredGoal(goal);
            setHoveredPrediction(null);
            if (svgRef.current && containerRef.current) {
              const containerRect = containerRef.current.getBoundingClientRect();
              const hoverX = event.clientX - containerRect.left;
              const hoverY = event.clientY - containerRect.top;
              setPopupPosition({ x: hoverX, y: hoverY });
            }
          })
          .on('mouseleave', function () {
            d3.select(this)
              .attr('r', 7)
              .attr('stroke-width', 2)
              .attr('opacity', 0.95);
            
            setHoveredGoal(null);
            setPopupPosition(null);
          })
          .on('click', function () {
            onMonthClick(d);
          });
      });
    });

    mainGroup
      .append('text')
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '16px')
      .attr('font-family', 'Space Grotesk, sans-serif')
      .attr('font-weight', '600')
      .attr('fill', 'oklch(0.75 0.15 200)')
      .text('TIMELINE');
  }, [data, filteredData, goals, onMonthClick, onPredictionSelect]);

  const calculatePopupPosition = () => {
    if (!popupPosition || !containerRef.current) {
      return { display: 'none' };
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const popupWidth = 320;
    const popupHeight = 400;
    const padding = 10;

    let left = popupPosition.x + 10;
    let top = popupPosition.y + 10;

    if (left + popupWidth > containerRect.width) {
      left = containerRect.width - popupWidth - padding;
    }

    if (top + popupHeight > containerRect.height) {
      top = containerRect.height - popupHeight - padding;
    }

    if (top < padding) {
      top = padding;
    }

    if (left < padding) {
      left = padding;
    }

    return {
      left,
      top,
      display: 'block',
    };
  };

  const popupStyle = calculatePopupPosition();

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <svg ref={svgRef} className="w-full h-full" />
      
      {(hoveredPrediction || hoveredGoal) && popupPosition && (
        <div
          className="absolute bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-2xl p-3 w-80 z-50 pointer-events-none"
          style={popupStyle}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {hoveredGoal ? 'Goal' : 'Prediction'}
            </h3>
          </div>
          
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {hoveredGoal && (
              <div className="flex items-start gap-2 p-2 rounded bg-background/40">
                <Target
                  weight="duotone"
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
                          style={{
                            color: DOMAIN_COLORS[domain],
                            borderColor: DOMAIN_COLORS[domain],
                          }}
                        >
                          {domain}
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
                    <p className="text-xs font-semibold text-foreground flex-1">
                      {hoveredPrediction.title}
                    </p>
                    <Badge
                      variant={hoveredPrediction.impact === 'high' ? 'destructive' : 'default'}
                      className="shrink-0"
                    >
                      {hoveredPrediction.impact}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {hoveredPrediction.description}
                  </p>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className="font-mono font-bold"
                      style={{ color: DOMAIN_COLORS[hoveredPrediction.domain] }}
                    >
                      {(hoveredPrediction.probability * 100).toFixed(0)}%
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span
                      style={{ color: DOMAIN_COLORS[hoveredPrediction.domain] }}
                    >
                      {DOMAIN_LABELS[hoveredPrediction.domain]}
                    </span>
                  </div>
                  {hoveredPrediction.sources && hoveredPrediction.sources.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Sources:
                      </p>
                      {hoveredPrediction.sources.map((source, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          {source.url ? (
                            <a
                              href={source.url}
                              rel="noopener noreferrer"
                              target="_blank"
                              className="text-[10px] text-primary hover:underline pointer-events-auto"
                            >
                              <Link className="inline" size={10} />
                              {source.name}
                              {source.confidence !== undefined && (
                                <span>
                                  {' '}({(source.confidence * 100).toFixed(0)}%)
                                </span>
                              )}
                            </a>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">
                              {source.name}
                              {source.confidence !== undefined && (
                                <span>
                                  {' '}({(source.confidence * 100).toFixed(0)}%)
                                </span>
                              )}
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
