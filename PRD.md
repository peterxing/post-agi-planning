# Planning Guide

A predictive intelligence platform that visualizes civilization's trajectory across multiple domains (individual, social, technological, economic, geopolitical, governance) over a 10-year horizon, enabling users to align personal goals with forecasted global conditions through both linear and circular timeline interfaces.

**Experience Qualities**: 
1. **Prescient** - The interface should feel like accessing a quantum supercomputer's vision of the future, revealing patterns invisible to the naked eye
2. **Empowering** - Users should feel equipped to navigate uncertainty by understanding how macro trends intersect with their micro decisions
3. **Crystalline** - Complex multidimensional data should resolve into clear, actionable insights through elegant visualization

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
- This application synthesizes multiple data sources (AI Futures Model, Future Timeline, prediction markets), manages multi-year planning data, implements sophisticated linear and circular visualization with probability calculations, and enables dynamic interaction between global forecasts and personal goal planning across six distinct analytical domains.

## Essential Features

**Linear Timeline Visualization (Future Timeline-style)**
- Functionality: Renders scrollable year-by-year timeline with expandable months showing dated events and predictions
- Purpose: Provides intuitive browsing of future events in chronological order similar to historical timelines
- Trigger: Default view on app load; updates when domain filters change
- Progression: App loads → Linear timeline displays years as cards → User expands year to see months → Events appear chronologically → User clicks event for details → Goals appear inline with events
- Success criteria: Timeline renders all years, years expand/collapse smoothly, events grouped by month, visual distinction between event types and impact levels

**Circular Timeline Visualization (Rehoboam-style)**
- Functionality: Renders 120-month circular timeline with radial spikes/troughs representing probability distributions for each domain
- Purpose: Provides intuitive grasp of future volatility and certainty across time and domains
- Trigger: Accessible via tab switch; updates when domain filters or date ranges change
- Progression: User switches to circular view → Circular timeline animates into view → User hovers over months to see detail → Spikes/troughs visualize probability variance → Color coding shows domain overlap
- Success criteria: Timeline renders smoothly with 120 data points, hover reveals month-specific predictions, visual distinction between high-certainty (tall spikes) and uncertain (low troughs) periods

**Multi-Domain Analysis Engine**
- Functionality: Tracks and visualizes predictions across six civilization domains (Individual, Social, Technological, Economic, Geopolitical, Governance)
- Purpose: Enables holistic understanding of how different aspects of civilization evolve and interact
- Trigger: User selects domain filters or views domain-specific insights panel
- Progression: User clicks domain toggle → Timeline updates to show domain-specific probabilities → Side panel displays key predictions for that domain → User can layer multiple domains → Interference patterns reveal correlations
- Success criteria: Each domain has distinct visual encoding, multiple domains can overlay, predictions are categorized correctly

**Personal Goal Planning System**
- Functionality: Users create, timeline, and track personal goals mapped against predicted global conditions
- Purpose: Transforms abstract forecasts into actionable personal strategy
- Trigger: User clicks "Add Goal" or timeline month
- Progression: User clicks timeline month → Goal creation dialog opens → User enters goal details and target date → Goal appears on timeline → System highlights relevant predictions for that timeframe → User receives context-aware insights → Goal saved with metadata
- Success criteria: Goals persist across sessions, appear on timeline with visual indicators, correlate with relevant domain predictions, editable and deletable

**Prediction Aggregation Dashboard**
- Functionality: Synthesizes data from AI Futures Model (aifuturesmodel.com), Future Timeline (futuretimeline.net), and other forecast sources into coherent month-by-month predictions with full source attribution and clickable links
- Purpose: Provides authoritative, multi-source validated predictions with transparent sourcing
- Trigger: Background data synthesis on load; user can view sources inline with each prediction
- Progression: App loads → System displays curated prediction data → Confidence scores shown → User views prediction → User sees source links inline → User clicks source link → External reference opens in new tab
- Success criteria: Predictions display confidence intervals, source attribution visible with clickable links, sources from futuretimeline.net and aifuturesmodel.com properly linked

**Lived Experience Simulator**
- Functionality: Generates narrative descriptions of predicted lived experience for any given month/year
- Purpose: Makes abstract predictions emotionally resonant and personally relevant
- Trigger: User clicks specific month on timeline
- Progression: User clicks month → Modal opens → AI generates lived experience narrative based on active predictions → Narrative includes sensory/social/technological context → User can regenerate or save narrative → Insights help inform goal planning
- Success criteria: Narratives feel plausible and grounded, incorporate multiple domain factors, respond to domain filters

**Timeline Navigation & Zoom**
- Functionality: Users can navigate through the 10-year timeline, zoom into specific periods, compare year-over-year
- Purpose: Enables both macro patterns and micro detail exploration
- Trigger: Scroll, pinch, or timeline controls
- Progression: User hovers over year segment → Year highlights → User clicks to zoom → Timeline expands to show 12-month detail → User can pan to adjacent months → Reset button returns to full view
- Success criteria: Smooth animations, no data loss at zoom levels, intuitive navigation controls

## Edge Case Handling

- **Data Unavailability**: Display last known forecast with timestamp, show data staleness indicator
- **Conflicting Predictions**: Show probability ranges and confidence intervals rather than single point estimates
- **Extreme Probabilities**: Cap visual spike heights at reasonable maximum to prevent layout breaks
- **No Goals Set**: Show onboarding overlay with sample goals and guided tutorial
- **Overlapping Goals**: Stack or cluster goals visually with expansion on hover
- **Far Future Uncertainty**: Increase visual noise/grain in timeline segments beyond 5 years to communicate epistemic humility
- **Mobile/Small Screens**: Provide alternative linear timeline view with swipe navigation

## Design Direction

The design should evoke the feeling of interfacing with a hyper-advanced AI oracle—clinical precision meets speculative wonder. Think black mirror meets Bloomberg Terminal: data-dense but never cluttered, futuristic without being sterile, authoritative yet accessible. The circular timeline should feel like a living organism, breathing with the ebb and flow of probable futures.

## Color Selection

The palette channels deep space observation technology and neural network visualizations—predominantly dark with luminous data accents.

- **Primary Color**: Deep Space Navy `oklch(0.15 0.03 250)` - Communicates depth, intelligence, the void from which predictions emerge
- **Secondary Colors**: 
  - Quantum Violet `oklch(0.25 0.08 280)` for UI chrome and secondary elements
  - Neural Gray `oklch(0.35 0.01 250)` for panels and cards
- **Accent Color**: Probability Cyan `oklch(0.75 0.15 200)` - Electric, attention-grabbing for CTAs, selected states, and high-confidence predictions
- **Domain Colors**:
  - Individual: Warm Amber `oklch(0.70 0.18 60)` 
  - Social: Coral Pink `oklch(0.68 0.17 20)`
  - Technological: Electric Blue `oklch(0.65 0.22 230)`
  - Economic: Money Green `oklch(0.72 0.16 145)`
  - Geopolitical: Ruby Red `oklch(0.58 0.21 25)`
  - Governance: Royal Purple `oklch(0.55 0.20 295)`
- **Foreground/Background Pairings**: 
  - Primary Navy Background `oklch(0.15 0.03 250)`: Pure White text `oklch(0.98 0 0)` - Ratio 11.2:1 ✓
  - Neural Gray Cards `oklch(0.35 0.01 250)`: Pure White text `oklch(0.98 0 0)` - Ratio 6.8:1 ✓
  - Accent Cyan `oklch(0.75 0.15 200)`: Deep Navy text `oklch(0.15 0.03 250)` - Ratio 7.4:1 ✓
  - Quantum Violet `oklch(0.25 0.08 280)`: Pure White text `oklch(0.98 0 0)` - Ratio 8.9:1 ✓

## Font Selection

Typography should feel like reading classified intelligence briefings from the future—technical precision with a hint of mystery.

- **Primary**: Space Grotesk - A geometric sans with futuristic character that maintains readability at small sizes for data-dense displays
- **Monospace**: JetBrains Mono - For numerical data, dates, and probability percentages to enhance scannability

- **Typographic Hierarchy**: 
  - H1 (App Title/View Headers): Space Grotesk Bold/32px/tight tracking (-0.02em)
  - H2 (Section Headers): Space Grotesk Semibold/24px/normal tracking
  - H3 (Subsections): Space Grotesk Medium/18px/normal tracking
  - Body (Descriptions): Space Grotesk Regular/16px/relaxed leading (1.6)
  - Data Labels: JetBrains Mono Medium/14px/monospace
  - Probability Values: JetBrains Mono Bold/18px/tabular numbers
  - Timeline Dates: JetBrains Mono Regular/12px/uppercase

## Animations

Animations should feel like quantum states collapsing into certainty—purposeful transitions that emphasize the app's predictive intelligence without distracting from data comprehension.

- **Timeline Entry**: Circular timeline draws in with staggered radial animation (1.2s custom easing)
- **Probability Spikes**: Gentle pulse on high-confidence months (subtle glow effect)
- **Domain Toggle**: Smooth fade and color shift when activating/deactivating domains (300ms)
- **Goal Addition**: Goal marker materializes with scale and fade-in (400ms spring physics)
- **Month Hover**: Radial segment highlight expands outward with trailing glow (150ms)
- **Data Updates**: Morphing transitions when probabilities change rather than hard cuts (500ms)
- **Panel Slides**: Side panels slide in from edges with slight overshoot for tactile feel (350ms)

## Component Selection

- **Components**: 
  - Dialog for goal creation/editing and lived experience narratives (full-screen on mobile)
  - Card for domain insight panels and prediction details
  - Tabs for switching between timeline view, data view, goals list
  - Tooltip for displaying quick stats on timeline hover
  - Popover for source citations and methodology info
  - Badge for probability confidence levels and domain tags
  - Slider for adjusting timeline zoom level
  - Button (ghost variant) for domain toggles with active state styling
  - ScrollArea for long prediction lists and narrative content
  - Separator for dividing domain sections
  
- **Customizations**: 
  - Custom circular SVG timeline component with D3.js for radial layout and path generation
  - Custom probability spike visualization using radial bars
  - Custom goal marker system with timeline integration
  - Glassmorphic panels with backdrop-blur for floating UI elements
  
- **States**: 
  - Buttons: Rest (subtle border), Hover (accent glow), Active (filled accent), Disabled (muted opacity)
  - Domain toggles: Inactive (grayscale), Active (full domain color with glow)
  - Timeline months: Default, Hover (expanded segment), Selected (persistent highlight), Has Goal (marker badge)
  - Probability spikes: Low (<40% - short, muted), Medium (40-70% - normal), High (>70% - tall, glowing)
  
- **Icon Selection**: 
  - Phosphor "TrendUp/TrendDown" for probability indicators
  - "Target" for goals
  - "Brain" for AI-generated insights
  - "Calendar" for timeline controls
  - "Eye" for lived experience preview
  - "Lightning" for high-impact predictions
  - "Info" for methodology/sources
  - Domain-specific icons: "User", "Users", "Cpu", "CurrencyDollar", "Globe", "Bank"
  
- **Spacing**: 
  - Container padding: px-6 py-8 (desktop), px-4 py-6 (mobile)
  - Card internal spacing: p-6
  - Timeline ring gap: 24px between year rings
  - Section spacing: space-y-8 for major sections, space-y-4 for related groups
  - Button spacing: px-4 py-2 for standard, px-6 py-3 for primary actions
  
- **Mobile**: 
  - Circular timeline switches to horizontal scrolling linear timeline below 768px
  - Domain toggles become horizontal scrolling pill selector
  - Floating panels become full-screen modal overlays
  - Timeline controls move to sticky bottom bar
  - Goal markers expand to show labels by default (no hover state)
  - Reduce typography scale by 15% across all headings
  - Stack prediction details vertically instead of side-by-side
