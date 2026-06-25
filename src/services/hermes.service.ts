import * as fs from 'fs';
import * as path from 'path';

/**
 * HermesService
 * Verwaltet das Schreiben von generiertem Code, Blueprints und Assets
 * direkt in deine lokale Verzeichnisstruktur (z. B. Unreal Engine 5 Projekt).
 */
export class HermesService {
    // Standard-Zielverzeichnis für den Code-Export (wird bei Bedarf angepasst)
    private static defaultTargetDir = path.resolve('C:\\Users\\Thaimachine\\Documents\\MainBrain\\MiuCode Apps Entwicklung\\Ultra Brain\\ExportedCode');

    /**
     * Schreibt den generierten Code in die angegebene Datei.
     * Erstellt Unterordner automatisch, falls diese nicht existieren.
     */
    public static exportFile(relativePath: string, content: string): { success: boolean; absolutePath: string; error?: string } {
        try {
            // Zielpfad berechnen
            const absolutePath = path.join(this.defaultTargetDir, relativePath);
            const directory = path.dirname(absolutePath);

            // Ordnerstruktur erstellen, falls sie nicht existiert
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
            }

            // Datei schreiben
            fs.writeFileSync(absolutePath, content, 'utf8');
            console.log(`[Hermes Service] Datei erfolgreich exportiert: ${absolutePath}`);

            return {
                success: true,
                absolutePath
            };
        } catch (e: any) {
            console.error('[Hermes Service] Fehler beim Schreiben der Datei:', e);
            return {
                success: false,
                absolutePath: '',
                error: e.message || 'Schreibfehler'
            };
        }
    }

    /**
     * Scant die Antwort der KI nach Code-Export-Befehlen und führt diese aus.
     * Format:
     * [HERMES_EXPORT filepath="Source/Miumiverse/Characters/Robin.h"]
     * ... code ...
     * [/HERMES_EXPORT]
     */
    public static processHermesExports(aiResponse: string): { cleanResponse: string; exportedFiles: string[] } {
        const regex = /\[HERMES_EXPORT\s+filepath="([^"]+)"\]([\s\S]*?)\[\/HERMES_EXPORT\]/g;
        let match;
        const exportedFiles: string[] = [];
        let cleanResponse = aiResponse;

        while ((match = regex.exec(aiResponse)) !== null) {
            const filepath = match[1];
            const content = match[2].trim();

            const result = this.exportFile(filepath, content);
            if (result.success) {
                exportedFiles.push(filepath);
            }
        }

        // Säubere die Antwort des Bots für die Chat-Anzeige (entferne die rohen Code-Blöcke)
        if (exportedFiles.length > 0) {
            cleanResponse = aiResponse.replace(/\[HERMES_EXPORT[\s\S]*?\[\/HERMES_EXPORT\]/g, (match) => {
                // Ersetze durch einen eleganten Hinweistext im Chat
                const innerMatch = /filepath="([^"]+)"/.exec(match);
                const pathStr = innerMatch ? innerMatch[1] : 'Datei';
                return `\n💾 *[Hermes] Die Datei \`${pathStr}\` wurde erfolgreich im Unreal-Projektverzeichnis generiert.*`;
            });
        }

        return { cleanResponse, exportedFiles };
    }
}
