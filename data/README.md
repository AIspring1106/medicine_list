# data フォルダー

- `config.js`：標準設定。`config.local.js` が読み込まれている場合は、その設定を優先します。
- `config.local.js.example`：v1.2.5から移行する際の設定テンプレート。コピーして `config.local.js` にし、従来の共通パスワードを設定します。
- `config.local.js`：管理者専用設定。通常の更新ZIPには含めません。GitHub Pages公開先に配置し、アプリ更新時も上書き・削除しないでください（ただしファイルは公開配信されます）。
- `medicines.json`：医薬品データ。`items` の各要素は `salesName` / `genericName` / `effect` を持ちます。
- `questions.json`：問題定義の将来拡張用テンプレート。現状のクイズは医薬品データから自動生成します。
- `flashcards.json`：カードデータの将来拡張用テンプレート。現状のカードは医薬品データから自動生成します。

元HTMLには具体的な医薬品データが含まれていないため、データ配列は空にしています。
