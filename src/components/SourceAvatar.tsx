import React, { useEffect, useState } from 'react';
import { Instagram, Facebook, Radar } from 'lucide-react';
import { SourcePlatform } from '../types';

interface SourceAvatarProps {
  src?: string | null;
  name?: string | null;
  platform?: SourcePlatform;
  className?: string;
  iconClassName?: string;
  eager?: boolean;
}

export const SourceAvatar: React.FC<SourceAvatarProps> = ({
  src,
  name,
  platform = 'other',
  className = 'w-10 h-10 rounded-xl',
  iconClassName = 'w-4 h-4',
  eager = false
}) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const usable = typeof src === 'string' && /^https?:\/\//i.test(src.trim()) && !failed;
  if (usable) {
    return (
      <img
        src={src!}
        alt={name || ''}
        className={`${className} object-cover border border-slate-700/80 bg-slate-800 flex-none`}
        loading={eager ? 'eager' : 'lazy'}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  const Icon = platform === 'instagram' ? Instagram : platform === 'facebook' ? Facebook : Radar;
  return (
    <div
      className={`${className} border border-slate-700/80 bg-slate-800 flex items-center justify-center text-slate-400 flex-none`}
      aria-label={name || undefined}
    >
      <Icon className={iconClassName} />
    </div>
  );
};
