import { useState, useEffect, useMemo, useCallback } from 'react';
import { useKV } from '@github/spark/hooks';
import type { Domain, MonthData, Goal, Prediction } from '@/lib/types';
import { generateTimelineData, getPredictionYearRange, getMonthName } from '@/lib/predictions';
import { applySignalsToTimeline, loadLiveSignals, summarizeSignalImpact, type LiveSignal } from '@/lib/live-signals';
import { CircularTimeline } from '@/components/CircularTimeline';
import { LinearTimeline } from '@/components/LinearTimeline';
import { DomainSelector } from '@/components/DomainSelector';
import { MonthDetailPanel } from '@/components/MonthDetailPanel';
import { GoalDialog } from '@/components/GoalDialog';
import { NarrativeDialog } from '@/components/NarrativeDialog';
import { GoalsList } from '@/components/GoalsList';
import { TechTreeChecklist } from '@/components/TechTreeChecklist';
import { LivedExperienceSummary } from '@/components/LivedExperienceSummary';
import { SignalFeedPanel } from '@/components/SignalFeedPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, Lightning } from '@phosphor-icons/react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

function App() {
  const currentYear = new Date().getFullYear();
  const [baseTimelineData, setBaseTimelineData] = useState<MonthData[]>([]);
  const [activeDomains, setActiveDomains] = useState<Domain[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<MonthData | null>(null);
  const [selectedPrediction, setSelectedPrediction] = useState<Prediction | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [narrativeDialogOpen, setNarrativeDialogOpen] = useState(false);
  const [goals, setGoals] = useKV<Goal[]>('rehoboam-goals', []);
  const [liveSignals, setLiveSignals] = useState<LiveSignal[]>([]);
  const [signalsGeneratedAt, setSignalsGeneratedAt] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<Record<string, string>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsError, setSignalsError] = useState<string | null>(null);

  useEffect(() => {
    const { minYear, maxYear } = getPredictionYearRange();
    const endYear = Math.max(maxYear, minYear + 10);
    const data = generateTimelineData(minYear, endYear);
    setBaseTimelineData(data);
  }, []);

  const refreshLiveSignals = useCallback(async () => {
    setSignalsLoading(true);
    try {
      const snapshot = await loadLiveSignals();
      setLiveSignals(snapshot.signals || []);
      setSignalsGeneratedAt(snapshot.generatedAt || new Date().toISOString());
      setSourceStatus(snapshot.sourceStatus || {});
      setSignalsError(null);
    } catch (error) {
      setLiveSignals([]);
      setSignalsError(error instanceof Error ? error.message : 'Unable to load live signals');
    } finally {
      setSignalsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLiveSignals();
    const intervalId = window.setInterval(refreshLiveSignals, 120000);
    return () => window.clearInterval(intervalId);
  }, [refreshLiveSignals]);

  const timelineData = useMemo(() => applySignalsToTimeline(baseTimelineData, liveSignals), [baseTimelineData, liveSignals]);
  const signalImpacts = useMemo(() => summarizeSignalImpact(liveSignals), [liveSignals]);

  const effectiveMonthData = useMemo(() => {
    if (selectedMonth) return selectedMonth;

    const now = new Date();
    const currentMonth = timelineData.find(
      (monthData) => monthData.year === now.getFullYear() && monthData.month === now.getMonth()
    );

    return currentMonth || timelineData[0] || null;
  }, [selectedMonth, timelineData]);

  useEffect(() => {
    if (!selectedMonth && effectiveMonthData) {
      setSelectedMonth(effectiveMonthData);
    }
  }, [selectedMonth, effectiveMonthData]);

  const handleDomainToggle = (domain: Domain) => {
    setActiveDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleMonthClick = (monthData: MonthData) => {
    setSelectedMonth(monthData);
    setSelectedPrediction(null);
  };

  const handleMonthHover = (_monthData: MonthData | null) => {
  };

  const handlePredictionSelect = (prediction: Prediction | null) => {
    setSelectedPrediction(prediction);
  };

  const handleCreateGoal = () => {
    setGoalDialogOpen(true);
  };

  const handleGenerateNarrative = () => {
    setNarrativeDialogOpen(true);
  };

  const handleSaveGoal = (goalData: Omit<Goal, 'id' | 'createdAt' | 'completed'>) => {
    const newGoal: Goal = {
      ...goalData,
      id: Date.now().toString(),
      createdAt: Date.now(),
      completed: false,
    };

    setGoals((current) => [...(current || []), newGoal]);
    toast.success('Goal created successfully');
  };

  const handleToggleGoalComplete = (id: string) => {
    setGoals((current) =>
      (current || []).map((goal) =>
        goal.id === id ? { ...goal, completed: !goal.completed } : goal
      )
    );
  };

  const handleDeleteGoal = (id: string) => {
    setGoals((current) => (current || []).filter((goal) => goal.id !== id));
    toast.success('Goal deleted');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative">
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 30%, oklch(0.25 0.08 280) 0%, transparent 50%),
              radial-gradient(circle at 80% 70%, oklch(0.15 0.03 250) 0%, transparent 50%),
              repeating-linear-gradient(
                0deg,
                transparent,
                transparent 2px,
                oklch(0.20 0.03 250) 2px,
                oklch(0.20 0.03 250) 4px
              )
            `,
          }}
        />

        <div className="relative z-10 container mx-auto px-4 py-8 space-y-8">
          <header className="text-center space-y-2 pb-6 border-b border-border/50">
            <div className="flex items-center justify-center gap-3">
              <Brain size={40} weight="duotone" className="text-primary" />
              <h1 className="text-4xl font-bold tracking-tight">REHOBOAM</h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-2xl mx-auto">
              Future Timeline & Civilization Forecast System • 2025-2035
            </p>
          </header>

          <Card className="p-6 bg-card/30 backdrop-blur-sm border-border/50">
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Analysis Domains
                </h2>
                <DomainSelector
                  activeDomains={activeDomains}
                  onToggle={handleDomainToggle}
                />
              </div>
            </div>
          </Card>

          <Card className="p-4 bg-card/30 backdrop-blur-sm border-border/50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Lightning className="text-primary" />
                <span className="font-medium">Live signal overlay active</span>
                <span className="text-muted-foreground">
                  {liveSignals.length} signal{liveSignals.length === 1 ? '' : 's'} impacting timeline probabilities
                </span>
              </div>
              <button
                type="button"
                onClick={refreshLiveSignals}
                className="text-xs text-primary hover:underline"
              >
                Refresh feed
              </button>
            </div>
          </Card>

          <Tabs defaultValue="linear" className="space-y-6">
            <TabsList className="grid w-full max-w-4xl mx-auto grid-cols-6">
              <TabsTrigger value="linear">Timeline</TabsTrigger>
              <TabsTrigger value="circular">Circular</TabsTrigger>
              <TabsTrigger value="signals">Signals ({liveSignals.length})</TabsTrigger>
              <TabsTrigger value="tech-tree">Tech Tree</TabsTrigger>
              <TabsTrigger value="lived">Experience</TabsTrigger>
              <TabsTrigger value="goals">Goals ({goals?.length || 0})</TabsTrigger>
            </TabsList>

            <TabsContent value="linear" className="space-y-6">
              <LinearTimeline
                data={timelineData}
                activeDomains={activeDomains}
                onMonthClick={handleMonthClick}
                goals={goals || []}
                selectedMonth={selectedMonth}
              />
            </TabsContent>

            <TabsContent value="circular" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <Card className="p-8 bg-card/30 backdrop-blur-sm border-border/50">
                    <div className="min-h-[700px] flex items-center justify-center">
                      <CircularTimeline
                        data={timelineData}
                        activeDomains={activeDomains}
                        onMonthClick={handleMonthClick}
                        onMonthHover={handleMonthHover}
                        onPredictionSelect={handlePredictionSelect}
                        goals={goals || []}
                        selectedMonth={selectedMonth}
                      />
                    </div>
                  </Card>
                </div>

                <div>
                  <div className="sticky top-8">
                    <MonthDetailPanel
                      monthData={selectedMonth}
                      selectedPrediction={selectedPrediction}
                      activeDomains={activeDomains}
                      onGenerateNarrative={handleGenerateNarrative}
                      onCreateGoal={handleCreateGoal}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="signals" className="space-y-6">
              <SignalFeedPanel
                signals={liveSignals}
                generatedAt={signalsGeneratedAt}
                sourceStatus={sourceStatus}
                impacts={signalImpacts}
                loading={signalsLoading}
                error={signalsError}
                onRefresh={refreshLiveSignals}
              />
            </TabsContent>

            <TabsContent value="tech-tree" className="space-y-6">
              <TechTreeChecklist
                year={effectiveMonthData?.year || currentYear}
                month={effectiveMonthData?.month || new Date().getMonth()}
              />
            </TabsContent>

            <TabsContent value="lived" className="space-y-6">
              <LivedExperienceSummary monthData={effectiveMonthData} />
            </TabsContent>

            <TabsContent value="goals" className="space-y-4">
              <Card className="p-4 bg-card/30 backdrop-blur-sm border-border/50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Goal planning</h3>
                    <p className="text-xs text-muted-foreground">
                      {effectiveMonthData
                        ? `Create goals quickly for ${getMonthName(effectiveMonthData.month)} ${effectiveMonthData.year}.`
                        : 'Create timeline-linked goals.'}
                    </p>
                  </div>
                  <Button onClick={handleCreateGoal} className="w-full sm:w-auto">
                    Add Goal
                  </Button>
                </div>
              </Card>

              <GoalsList
                goals={goals || []}
                onToggleComplete={handleToggleGoalComplete}
                onDelete={handleDeleteGoal}
              />
            </TabsContent>
          </Tabs>

          <footer className="text-center text-xs text-muted-foreground pt-8 border-t border-border/50">
            <p>
              Base predictions synthesized from AI Futures Model, Future Timeline, and forecasting research.
              Live probability pressure overlays are ingested from X API and Polymarket market data.
            </p>
          </footer>
        </div>
      </div>

      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        onSave={handleSaveGoal}
        initialMonth={effectiveMonthData || undefined}
      />

      <NarrativeDialog
        open={narrativeDialogOpen}
        onOpenChange={setNarrativeDialogOpen}
        monthData={selectedMonth}
        activeDomains={activeDomains}
      />

      <Toaster />
    </div>
  );
}

export default App;
