import {useEffect, useState} from 'react';

// Celular e telas estreitas: os gráficos trocam de forma abaixo desta largura.
export const NARROW = '(max-width: 640px)';
export function useNarrow(query = NARROW) {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const list = matchMedia(query), change = () => setNarrow(list.matches);
    change(); list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return narrow;
}
