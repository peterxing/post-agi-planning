import type { Domain } from '@/lib/types';
import { DOMAIN_LABELS } from '@/lib/predictions';
import { Button } from '@/components/ui/button';
import { User, Users, Cpu, CurrencyDollar, Globe, Bank } from '@phosphor-icons/react';

interface DomainSelectorProps {
  activeDomains: Domain[];
  onToggle: (domain: Domain) => void;
}

const DOMAIN_ICONS: Record<Domain, React.ReactNode> = {
  individual: <User weight="duotone" />,
  social: <Users weight="duotone" />,
  tech: <Cpu weight="duotone" />,
  economic: <CurrencyDollar weight="duotone" />,
  geopolitical: <Globe weight="duotone" />,
  governance: <Bank weight="duotone" />,
};

export function DomainSelector({ activeDomains, onToggle }: DomainSelectorProps) {
  const domains: Domain[] = ['individual', 'social', 'tech', 'economic', 'geopolitical', 'governance'];

  return (
    <div className="flex flex-wrap gap-2">
      {domains.map((domain) => {
        const isActive = activeDomains.includes(domain);
        
        return (
          <Button
            key={domain}
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            onClick={() => onToggle(domain)}
            className={`
              font-medium transition-all duration-300
              ${isActive ? `domain-glow-${domain}` : 'opacity-60 hover:opacity-100'}
            `}
            style={
              isActive
                ? {
                    backgroundColor: `var(--domain-${domain})`,
                    borderColor: `var(--domain-${domain})`,
                    color: 'oklch(0.15 0.03 250)',
                  }
                : {}
            }
          >
            <span className="flex items-center gap-2">
              {DOMAIN_ICONS[domain]}
              {DOMAIN_LABELS[domain]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
