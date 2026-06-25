/**
 * MiumiverseService
 * Übersetzt den Canvas-Zustand (Nodes & Verbindungen) in verständlichen Text für die KI
 * und parst KI-Befehle zur Live-Manipulation des Canvas.
 */

export interface CanvasNode {
    id: string;
    type: 'note' | 'todo' | 'folder';
    x: number;
    y: number;
    title: string;
    content: any;
    color: string;
    shape?: 'rect' | 'circle';
}

export interface CanvasConnection {
    id: string;
    from: string;
    fromPort: 'input' | 'output';
    to: string;
    toPort: 'input' | 'output';
}

export interface CanvasContext {
    nodes: CanvasNode[];
    connections: CanvasConnection[];
}

export class MiumiverseService {
    /**
     * Übersetzt das Canvas-JSON in eine strukturierte, textuelle Beschreibung für den Systemprompt.
     */
    public static generateSystemContext(context: CanvasContext | null): string {
        if (!context || !context.nodes || context.nodes.length === 0) {
            return `[Miumiverse Canvas-Zustand]
Aktuell sind keine Elemente oder Strukturen auf dem visuellen Canvas gezeichnet.`;
        }

        let prompt = `\n=== AKTUELLER MIUNIVERSE CANVAS-ZUSTAND ===\n`;
        prompt += `Du hast Zugriff auf das visuelle Board des Nutzers. Hier sind die gezeichneten Elemente:\n\n`;

        // 1. Ordner & Nodes auflisten
        prompt += `--- GEZEICHNETE ELEMENTE (NODES) ---\n`;
        context.nodes.forEach(node => {
            const shapeStr = node.shape ? ` (Form: ${node.shape})` : '';
            if (node.type === 'todo') {
                const items = Array.isArray(node.content) 
                    ? node.content.map((i: any) => `  [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')
                    : '  (Keine Items)';
                prompt += `ID: ${node.id} | Typ: TODO-LISTE | Name: "${node.title}"\nItems:\n${items}\n\n`;
            } else if (node.type === 'folder') {
                prompt += `ID: ${node.id} | Typ: ORDNER | Name: "${node.title}"\n\n`;
            } else {
                prompt += `ID: ${node.id} | Typ: NOTIZ${shapeStr} | Name: "${node.title}" | Inhalt: "${node.content}"\n\n`;
            }
        });

        // 2. Verbindungen auflisten
        if (context.connections && context.connections.length > 0) {
            prompt += `--- VERKNÜPFUNGEN (VERBINDUNGEN) ---\n`;
            context.connections.forEach(conn => {
                const fromNode = context.nodes.find(n => n.id === conn.from);
                const toNode = context.nodes.find(n => n.id === conn.to);
                if (fromNode && toNode) {
                    prompt += `"${fromNode.title}" (${fromNode.type}) ──► "${toNode.title}" (${toNode.type})\n`;
                }
            });
        } else {
            prompt += `Es sind aktuell keine Elemente miteinander verbunden.\n`;
        }

        prompt += `\n==========================================\n`;
        prompt += `\nSTEUERUNGS-REGELN FÜR DICH (KI):
Wenn du neue Elemente auf dem Canvas erstellen, löschen oder verbinden möchtest, füge am Ende deiner Antwort einen JSON-Block im folgenden Format ein. Das System wird dies live auf dem Bildschirm des Nutzers ausführen.

Beispiel für Aktionen:
[CANVAS_ACTION]
{
  "actions": [
    {
      "type": "CREATE_NODE",
      "nodeType": "note",
      "title": "Neuer Skill: Feuerball",
      "content": "Verursacht 50 Brandschaden",
      "color": "#EF4444",
      "shape": "rect",
      "x": 200,
      "y": 150
    },
    {
      "type": "CREATE_CONNECTION",
      "from": "node_id_quelle",
      "to": "node_id_ziel"
    }
  ]
}
[/CANVAS_ACTION]

Verwende sinnvolle Koordinaten (z. B. in der Nähe bestehender Nodes). Die IDs für neue Verbindungen werden automatisch generiert. Halte dich exakt an dieses Format, wenn der Nutzer Änderungen wünscht!`;

        return prompt;
    }

    /**
     * Scant die Antwort der KI nach [CANVAS_ACTION] Blöcken und extrahiert die Befehle.
     */
    public static extractCanvasActions(aiResponse: string): { cleanResponse: string; actions: any[] } {
        const regex = /\[CANVAS_ACTION\]([\s\S]*?)\[\/CANVAS_ACTION\]/;
        const match = aiResponse.match(regex);

        if (!match) {
            return { cleanResponse: aiResponse, actions: [] };
        }

        try {
            const jsonStr = match[1].trim();
            const parsed = JSON.parse(jsonStr);
            const actions = parsed.actions || [];
            
            // Säubere die Antwort des Bots (entferne den JSON-Block für die Anzeige im Chat)
            const cleanResponse = aiResponse.replace(regex, '').trim();
            return { cleanResponse, actions };
        } catch (e) {
            console.warn('Fehler beim Parsen der Canvas-Aktion von der KI:', e);
            return { cleanResponse: aiResponse, actions: [] };
        }
    }
}
