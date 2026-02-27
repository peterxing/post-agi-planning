import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DOMAIN_COLORS, DOMAIN_LABELS } from '@/lib/predictions';
import type { Domain } from '@/lib/types';
import type { LiveSignal, DomainSignalImpact } from '@/lib/live-signals';
import { formatSignalTarget } from '@/lib/live-signals';
import { formatDistanceToNow } from 'date-fns';
import { ArrowClockwise, Lightning, LinkSimple, TrendDown, TrendUp } from '@phosphor-icons/react';

interface SignalFeedPanelProps {
  signals: LiveSignal[];
  generatedAt: string | null;
  sourceStatus?: Record<string, string>;
  impacts: DomainSignalImpact[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatDelta(delta: number): string {
  const points = delta * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)}pp`;
}

function sourceLabel(source: LiveSignal['source']): string {
  return source === 'x' ? 'X API' : 'Polymarket';
}

export function SignalFeedPanel({
  signals,
  generatedAt,
  sourceStatus,
  impacts,
  loading,
  error,
  onRefresh,
}: SignalFeedPanelProps) {
  const sortedSignals = [...signals].sort((a, b) => {
    const sigDiff = b.significance - a.significance;
    if (sigDiff !== 0) return sigDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const totalNetDelta = signals.reduce((acc, signal) => acc + signal.probabilityDelta, 0);
  const highSignificanceCount = signals.filter((signal) => signal.significance >= 0.65).length;
  const avgSignificance = signals.length
    ? signals.reduce((acc, signal) => acc + signal.significance, 0) / signals.length
    : 0;

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-card/40 backdrop-blur-sm border-border/50">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Live Signals Feed</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Significant events from X and Polymarket are mapped into domain-level timeline probability shifts.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {generatedAt
                ? `Last updated ${formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}`
                : 'No feed snapshot loaded yet.'}
            </p>
          </div>

          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <ArrowClockwise className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing...' : 'Refresh feed'}
          </Button>
        </div>

        {!!sourceStatus && Object.keys(sourceStatus).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(sourceStatus).map(([source, status]) => (
              <Badge key={source} variant="secondary" className="font-mono text-xs">
                {source}: {status}
              </Badge>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-card/30 border-border/50">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Signals in window</div>
          <div className="text-2xl font-bold mt-1">{signals.length}</div>
          <div className="text-xs text-muted-foreground mt-1">{highSignificanceCount} high-significance</div>
        </Card>

        <Card className="p-4 bg-card/30 border-border/50">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Aggregate pressure</div>
          <div className="text-2xl font-bold mt-1 flex items-center gap-2">
            {totalNetDelta >= 0 ? <TrendUp className="text-domain-tech" /> : <TrendDown className="text-domain-geopolitical" />}
            {formatDelta(totalNetDelta)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Net directional impact across all domains</div>
        </Card>

        <Card className="p-4 bg-card/30 border-border/50">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Average significance</div>
          <div className="text-2xl font-bold mt-1">{(avgSignificance * 100).toFixed(0)}%</div>
          <div className="text-xs text-muted-foreground mt-1">Confidence-weighting applied to deltas</div>
        </Card>
      </div>

      <Card className="p-4 bg-card/30 border-border/50">
        <h3 className="text-sm font-semibold mb-3">Domain impact rollup</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {impacts.map((impact) => {
            const color = DOMAIN_COLORS[impact.domain as Domain];
            return (
              <div key={impact.domain} className="rounded-md border border-border/50 p-3 bg-background/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {DOMAIN_LABELS[impact.domain]}
                  </span>
                  <Badge variant="outline" className="text-xs">{impact.count} signal{impact.count === 1 ? '' : 's'}</Badge>
                </div>
                <div className="mt-2 text-lg font-bold" style={{ color }}>
                  {formatDelta(impact.netDelta)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Avg significance {(impact.avgSignificance * 100).toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden bg-card/30 border-border/50">
        <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
          <Lightning className="text-primary" />
          <h3 className="text-sm font-semibold">Significant events feed</h3>
        </div>

        <ScrollArea className="h-[560px]">
          <div className="p-4 space-y-3">
            {sortedSignals.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No live signals loaded. Run the sync script to ingest from X and Polymarket.
              </div>
            )}

            {sortedSignals.map((signal) => {
              const deltaUp = signal.probabilityDelta >= 0;
              const significancePct = Math.max(0, Math.min(100, signal.significance * 100));

              return (
                <div key={signal.id} className="rounded-lg border border-border/50 p-3 bg-background/20">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Badge variant="secondary" className="text-xs font-mono">
                      {sourceLabel(signal.source)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={{ borderColor: DOMAIN_COLORS[signal.domain], color: DOMAIN_COLORS[signal.domain] }}
                    >
                      {DOMAIN_LABELS[signal.domain]}
                    </Badge>
                    <Badge className={`text-xs ${deltaUp ? 'bg-domain-tech/20 text-domain-tech' : 'bg-domain-geopolitical/20 text-domain-geopolitical'}`}>
                      {formatDelta(signal.probabilityDelta)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Target: {formatSignalTarget(signal)}</span>
                  </div>

                  <h4 className="text-sm font-semibold leading-tight">{signal.headline}</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{signal.summary}</p>

                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Significance</span>
                      <span>{significancePct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${significancePct}%`, backgroundColor: DOMAIN_COLORS[signal.domain] }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDistanceToNow(new Date(signal.timestamp), { addSuffix: true })}
                    </span>
                    {signal.url && (
                      <a href={signal.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        Source <LinkSimple size={12} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Model note: signal deltas are a bounded overlay, not an absolute truth. Treat as directional pressure and update weighting logic as your calibration improves.
      </p>
    </div>
  );
}
