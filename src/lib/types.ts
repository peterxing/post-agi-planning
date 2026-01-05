export type Domain = 
  | 'individual' 
  | 'social' 
  | 'tech' 
  | 'economic' 
  | 'geopolitical' 
  | 'governance';

export interface PredictionSource {
  name: string;
  url?: string;
  confidence?: number;
}

export interface Prediction {
  id: string;
  domain: Domain;
  month: number;
  year: number;
  probability: number;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  sources: PredictionSource[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetMonth: number;
  targetYear: number;
  domains: Domain[];
  completed: boolean;
  createdAt: number;
}

export interface MonthData {
  month: number;
  year: number;
  probabilities: Record<Domain, number>;
  predictions: Prediction[];
}

export interface TimelineConfig {
  startYear: number;
  endYear: number;
  currentYear: number;
  currentMonth: number;
}

export type TechTreeStatus = 
  | 'not-started'
  | 'r-and-d'
  | 'pilot'
  | 'early-adopters'
  | 'mass-market'
  | 'ubiquitous'
  | 'regulated';

export type LifeVariable =
  | 'sleep'
  | 'morning-planning'
  | 'meals'
  | 'work'
  | 'income-model'
  | 'education'
  | 'commute'
  | 'entertainment'
  | 'social-life'
  | 'relationships'
  | 'family'
  | 'health'
  | 'privacy'
  | 'safety'
  | 'trust'
  | 'finance'
  | 'routines'
  | 'energy'
  | 'politics'
  | 'governance';

export interface TechTreeNode {
  id: string;
  category: 'individual' | 'society' | 'economy' | 'governance' | 'geopolitics';
  subcategory: string;
  title: string;
  windowStart: { year: number; month: number };
  windowEnd: { year: number; month: number };
  dependsOn?: string[];
  indicators: string[];
  tags: LifeVariable[];
  description?: string;
}

export interface TechTreeState {
  nodeId: string;
  status: TechTreeStatus;
  updatedAt: number;
}
