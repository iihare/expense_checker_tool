// paddleOCRTest.js
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("paddleTestFile");
  const button = document.getElementById("paddleTestButton");
  const status = document.getElementById("paddleTestStatus");
  const result = document.getElementById("paddleTestResult");

  if (!fileInput || !button) return;

  button.addEventListener("click", async () => {
    const file = fileInput.files[0];

    if (!file) {
      status.textContent = "請先選擇圖片。";
      return;
    }

    button.disabled = true;
    status.textContent = "正在初始化及辨識，第一次可能需要較長時間...";
    result.textContent = "";

    try {
      const data = await window.PaddleOCRTest.recognizeImage(file);

      status.textContent = "辨識完成！";

      result.textContent = data.items
        .map(item => item.text)
        .join("\n");

      console.log("PaddleOCR 完整結果：", data);

      console.table(data.items.map(item => ({
        辨識文字: item.text,
        信心分數: item.score,
        座標: JSON.stringify(item.poly)
      })));

      console.log("辨識效能：", data.metrics);

    } catch (error) {
      console.error(error);
      status.textContent = `辨識失敗：${error.message}`;

    } finally {
      button.disabled = false;
    }
  });
});
