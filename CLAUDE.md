# IMAT University Selector — Project Context

## Stack
- Single file: index.html (JS inline, no build step)
- Data: Google Sheets API (public, no auth required)
- Deploy: Vercel

## Aesthetic
- Reference: https://atlas-delta-five.vercel.app
- Dark background, monospace accents, dense data display
- Minimal chrome, no decorative elements

## Data Flow
Sheets API → fetch on load → calculate CB in frontend → render ranking

## Google Sheets Structure
Pre-calculated columns (0–100):
- Qs_rep_calc, Qs_rank_calc, THE_rank_calc, Censis_calc, Nat_index_calc, QOL_calc, COL_calc
- SCORE_Q
- C/O
- CoL_index (Numbeo Cost of Living, sem rent)
- QoL_index (Lab24 Il Sole 24 Ore ÷ 10)
- Non-EU Seats
- city_size: 0 = small; 1 = medium sized; 2 = large

## Quality Score Formula (Sheets)
Score = 0.35·N_QS_rep + 0.25·N_QS_med + 0.20·N_THE + 0.15·N_Censis + 0.05·N_Nature

## Cost-Benefit Formula (frontend)
CB = Score_qualidade × (1 - w × N_corte/100)
w ∈ [0,1] — user-controlled slider

## Normalization Rules
- Ordinal rankings (QS med, THE): lower = better → inverted min-max
- Scores (QS rep, Censis, Nature): higher = better → direct min-max
- Missing data: exclude source, redistribute weights proportionally
- Corte: 0.70×2025 + 0.30×2023

## UI Components
1. Drag-and-drop: prioridade entre 4 dimensões
   - Qualidade Acadêmica (Score_qualidade)
   - Custo de Vida (CoL_index — menor = melhor)
   - Qualidade de Vida (QoL_index — maior = melhor)
   - Facilidade de Entrada (N_corte invertido — menor corte = melhor)
   Pesos fixos por posição: 1º→40%, 2º→30%, 3º→20%, 4º→10%

2. Table: ranked output, all normalized columns visible
3. Row click: expanded university card
