import { useState, useEffect } from 'react';
import { useKV } from '@github/spark/hooks';
import type { Domain, MonthData, Goal, Prediction } from '@/lib/types';
import { generateTimelineData, getPredictionYearRange } from '@/lib/predictions';
import { CircularTimeline } from '@/components/CircularTimeline';
import { LinearTimeline } from '@/components/LinearTimeline';
import { DomainSelector } from '@/components/DomainSelector';
import { MonthDetailPanel } from '@/components/MonthDetailPanel';
import { GoalDialog } from '@/components/GoalDialog';
import { NarrativeDialog } from '@/components/NarrativeDialog';
import { GoalsList } from '@/components/GoalsList';
import { TechTreeChecklist } from '@/components/TechTreeChecklist';
import { LivedExperienceSummary } from '@/components/LivedExperienceSummary';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Brain } from '@phosphor-icons/react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

function App() {
  const currentYear = new Date().getFullYear();
  const [timelineData, setTimelineData] = useState<MonthData[]>([]);
  const [activeDomains, setActiveDomains] = useState<Domain[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<MonthData | null>(null);
  const [selectedPrediction, setSelectedPrediction] = useState<Prediction | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [narrativeDialogOpen, setNarrativeDialogOpen] = useState(false);
  const [goals, setGoals] = useKV<Goal[]>('rehoboam-goals', []);

  useEffect(() => {
    const { minYear, maxYear } = getPredictionYearRange();
    const endYear = Math.max(maxYear, minYear + 10);
    const data = generateTimelineData(minYear, endYear);
    setTimelineData(data);
  }, []);

  const handleDomainToggle = (domain: Domain) => {
    setActiveDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleMonthClick = (monthData: MonthData) => {
    setSelectedMonth(monthData);
    setSelectedPrediction(null);
  };

  const handleMonthHover = (monthData: MonthData | null) => {
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

          <Tabs defaultValue="linear" className="space-y-6">
            <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-5">
              <TabsTrigger value="linear">Timeline</TabsTrigger>
              <TabsTrigger value="circular">Circular</TabsTrigger>
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

            <TabsContent value="tech-tree" className="space-y-6">
              <TechTreeChecklist
                year={selectedMonth?.year || currentYear}
                month={selectedMonth?.month || new Date().getMonth()}
              />
            </TabsContent>

            <TabsContent value="lived" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TechTreeChecklist
                  year={selectedMonth?.year || currentYear}
                  month={selectedMonth?.month || new Date().getMonth()}
                />
                <LivedExperienceSummary monthData={selectedMonth} />
              </div>
            </TabsContent>

            <TabsContent value="goals">
              <GoalsList
                goals={goals || []}
                onToggleComplete={handleToggleGoalComplete}
                onDelete={handleDeleteGoal}
              />
            </TabsContent>
          </Tabs>

          <footer className="text-center text-xs text-muted-foreground pt-8 border-t border-border/50">
            <p>
              Predictions synthesized from AI Futures Model, Future Timeline, and forecasting research
            </p>
          </footer>
        </div>
      </div>

      <GoalDialog
        open={goalDialogOpen}
        onOpenChange={setGoalDialogOpen}
        onSave={handleSaveGoal}
        initialMonth={selectedMonth || undefined}
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