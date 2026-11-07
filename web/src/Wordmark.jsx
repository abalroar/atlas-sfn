import React from 'react';
import '@fontsource-variable/fraunces/full.css';
import './wordmark.css';

/** Marca do Atlas: Fraunces (OFL) em tamanho óptico de título, com o subtítulo em Hanken Grotesk. */
export default function Wordmark({subtitle = true}) {
  return <span className="atlas-mark"><span className="atlas-mark-name">Atlas</span>{subtitle && <span className="atlas-mark-sub">do dinheiro e patrimônio no território brasileiro</span>}</span>;
}
