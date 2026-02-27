import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Goal, Domain, MonthData } from '@/lib/types';
import { DomainSelector } from './DomainSelector';
import { getMonthName } from '@/lib/predictions';

interface GoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (goal: Omit<Goal, 'id' | 'createdAt' | 'completed'>) => void;
  initialMonth?: MonthData;
}

export function GoalDialog({ open, onOpenChange, onSave, initialMonth }: GoalDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetMonth, setTargetMonth] = useState(initialMonth?.month ?? 0);
  const [targetYear, setTargetYear] = useState(initialMonth?.year ?? new Date().getFullYear());
  const [domains, setDomains] = useState<Domain[]>([]);

  useEffect(() => {
    if (initialMonth) {
      setTargetMonth(initialMonth.month);
      setTargetYear(initialMonth.year);
    }
  }, [initialMonth]);

  const handleDomainToggle = (domain: Domain) => {
    setDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleSave = () => {
    if (!title.trim()) return;

    onSave({
      title: title.trim(),
      description: description.trim(),
      targetMonth,
      targetYear,
      domains,
    });

    setTitle('');
    setDescription('');
    setDomains([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[550px] max-h-[92dvh] overflow-hidden p-0 bg-card border-border sm:p-6">
        <DialogHeader className="px-4 pt-6 pb-3 sm:px-0 sm:pt-0 sm:pb-2">
          <DialogTitle className="text-2xl font-bold">Create Personal Goal</DialogTitle>
          <DialogDescription>
            Plan a goal for{' '}
            <span className="font-mono text-primary font-semibold">
              {getMonthName(targetMonth)} {targetYear}
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(92dvh-12.5rem)] px-4 sm:px-0">
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="goal-title">Goal Title</Label>
              <Input
                id="goal-title"
                placeholder="e.g., Launch AI-powered product"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-background/50 h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-description">Description</Label>
              <Textarea
                id="goal-description"
                placeholder="Describe your goal and how it relates to predicted conditions..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="bg-background/50 resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label>Target Date</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <select
                    value={targetMonth}
                    onChange={(e) => setTargetMonth(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-md border border-input bg-background/50 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i} value={i}>
                        {getMonthName(i)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Input
                    type="number"
                    value={targetYear}
                    onChange={(e) => setTargetYear(Number(e.target.value))}
                    min={new Date().getFullYear()}
                    max={new Date().getFullYear() + 10}
                    className="bg-background/50 h-11"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Related Domains</Label>
              <DomainSelector activeDomains={domains} onToggle={handleDomainToggle} />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-4 py-3 border-t border-border/50 sm:px-0 sm:py-0 sm:border-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!title.trim()} className="h-11 w-full sm:w-auto">
            Save Goal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
