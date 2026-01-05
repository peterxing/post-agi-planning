import type { Goal, Domain } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { getMonthName, DOMAIN_LABELS } from '@/lib/predictions';
import { Target, Trash } from '@phosphor-icons/react';

interface GoalsListProps {
  goals: Goal[];
  onToggleComplete: (id: string) => void;
  onDelete: (id: string) => void;
}

export function GoalsList({ goals, onToggleComplete, onDelete }: GoalsListProps) {
  const sortedGoals = [...goals].sort((a, b) => {
    if (a.targetYear !== b.targetYear) return a.targetYear - b.targetYear;
    return a.targetMonth - b.targetMonth;
  });

  if (goals.length === 0) {
    return (
      <Card className="p-8 bg-card/50 backdrop-blur-sm border-border/50">
        <div className="text-center space-y-3">
          <Target size={48} className="mx-auto text-muted-foreground opacity-50" />
          <div>
            <h3 className="font-semibold text-lg mb-1">No Goals Yet</h3>
            <p className="text-sm text-muted-foreground">
              Click on the timeline to create your first goal
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Target weight="duotone" className="text-primary" />
        Your Goals ({goals.length})
      </h3>

      <ScrollArea className="h-[400px] -mx-2 px-2">
        <div className="space-y-3">
          {sortedGoals.map((goal) => (
            <div
              key={goal.id}
              className={`p-4 rounded-lg border transition-all ${
                goal.completed
                  ? 'border-border/30 bg-background/10 opacity-60'
                  : 'border-border/50 bg-background/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={goal.completed}
                  onCheckedChange={() => onToggleComplete(goal.id)}
                  className="mt-1"
                />

                <div className="flex-1 space-y-2">
                  <div>
                    <h4
                      className={`font-semibold leading-tight ${
                        goal.completed ? 'line-through' : ''
                      }`}
                    >
                      {goal.title}
                    </h4>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {getMonthName(goal.targetMonth)} {goal.targetYear}
                    </p>
                  </div>

                  {goal.description && (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {goal.description}
                    </p>
                  )}

                  {goal.domains.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {goal.domains.map((domain) => (
                        <Badge
                          key={domain}
                          variant="outline"
                          className="text-xs"
                          style={{
                            borderColor: `var(--domain-${domain})`,
                            color: `var(--domain-${domain})`,
                          }}
                        >
                          {DOMAIN_LABELS[domain]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(goal.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
