(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png"]);

  // 匯入檔案獨立保存，不放進 appState，也不直接改動表單或經費資料。
  const documentState = {
    applicationFiles: [],
    expenseFiles: [],
  
    parsedApplicationDocuments: [],
    parsedExpenseDocuments: [],
    parsedExpenseRows: [],
  
    isProcessing: false
  };

  window.documentImportState = documentState;

  const getExtension = (fileName) => {
    const parts = String(fileName || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  };

  const isSupportedFile = (file) => {
    const extension = getExtension(file.name);
    return allowedExtensions.has(extension) && file.size > 0;
  };

  const isDuplicate = (files, candidate) => files.some((file) =>
    file.name === candidate.name &&
    file.size === candidate.size &&
    file.lastModified === candidate.lastModified
  );

  const formatCount = (count) => count > 0 ? `${count} 個檔案` : "尚未選擇";

  function updateImportControls() {
    const button = $("startOcrBtn");
    if (!button) return;
  
    button.disabled =
      documentState.isProcessing ||
      documentState.expenseFiles.length === 0;
  
    button.textContent = documentState.isProcessing
      ? "辨識中……"
      : "開始辨識";
  }
  
  function setImportFeedback(message) {
    const notice = $("importNotice");
    if (!notice) return;
  
    let feedback = notice.querySelector(".import-processing-feedback");
  
    if (!feedback) {
      feedback = document.createElement("span");
      feedback.className = "import-processing-feedback";
      notice.appendChild(feedback);
    }
  
    feedback.textContent = message;
  }
  
  function renderFileList(type) {
    const isApplication = type === "application";
    const files = isApplication
      ? documentState.applicationFiles
      : documentState.expenseFiles;
    const list = $(isApplication ? "applicationFileList" : "expenseFileList");
    const count = $(isApplication ? "applicationFileCount" : "expenseFileCount");

    if (!list || !count) return;

    count.textContent = formatCount(files.length);
    list.replaceChildren();

    if (files.length === 0) {
      const empty = document.createElement("li");
      empty.className = "import-empty-files";
      empty.textContent = "尚未選擇檔案";
      list.appendChild(empty);
      return;
    }

    files.forEach((file, index) => {
      const item = document.createElement("li");
      item.className = "import-file-item";

      const name = document.createElement("span");
      name.className = "import-file-name";
      name.textContent = file.name;
      name.title = file.name;

      const removeButton = document.createElement("button");
      removeButton.className = "import-remove-file-btn";
      removeButton.type = "button";
      removeButton.textContent = "移除";
      removeButton.setAttribute("aria-label", `移除檔案：${file.name}`);
      removeButton.addEventListener("click", () => {
        files.splice(index, 1);
        renderFileList(type);
      });

      item.append(name, removeButton);
      list.appendChild(item);
    });
  }

  function addSelectedFiles(type, selectedFiles) {
    const files = type === "application"
      ? documentState.applicationFiles
      : documentState.expenseFiles;

    let addedCount = 0;
    let unsupportedCount = 0;
    let duplicateCount = 0;

    Array.from(selectedFiles).forEach((file) => {
      if (!isSupportedFile(file)) {
        unsupportedCount += 1;
        return;
      }

      if (isDuplicate(files, file)) {
        duplicateCount += 1;
        return;
      }

      files.push(file);
      addedCount += 1;
    });

    renderFileList(type);
    if (type === "expense" && addedCount > 0) {
      documentState.parsedDocuments = [];
      documentState.parsedExpenseRows = [];
    }
    
    updateImportControls();

    const messages = [];
    if (addedCount) messages.push(`已加入 ${addedCount} 個檔案`);
    if (duplicateCount) messages.push(`略過 ${duplicateCount} 個重複檔案`);
    if (unsupportedCount) messages.push(`略過 ${unsupportedCount} 個不支援或空白檔案`);

    const notice = $("importNotice");
    if (notice && messages.length) {
      const detail = document.createElement("span");
      detail.textContent = messages.join("；");
      const oldDetail = notice.querySelector(".import-selection-feedback");
      if (oldDetail) oldDetail.remove();
      detail.className = "import-selection-feedback";
      notice.appendChild(detail);
    }
  }

  function openImportModal() {
    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $("closeImportModalBtn")?.focus();
  }

  function closeImportModal() {
    if (documentState.isProcessing) return;
    const backdrop = $("importModalBackdrop");
    if (!backdrop) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    $("importFilesBtn")?.focus();
  }


  /**
   * 處理申請書 OCR、解析及資料寫回。
   *
   * @returns {Promise<boolean>}
   * true：處理成功
   * false：沒有檔案或處理失敗
   */
  async function processApplicationFiles() {
  
    const files = [...documentState.applicationFiles];
  
    if (files.length === 0) {
      return false;
    }
  
    // 清除上一次的解析結果
    documentState.parsedApplicationDocuments = [];
  
    const allPages = [];
    const failedFiles = [];
  
    // ---------- 1. 逐一執行 OCR ----------
  
    for (const file of files) {
  
      try {
  
        const result = await window.importsOCR.readDocument(file);
  
        if (
          !result ||
          !Array.isArray(result.pages) ||
          result.pages.length === 0
        ) {
          throw new Error("沒有取得有效的 OCR 頁面。");
        }
  
        allPages.push(...result.pages);
  
      } catch (error) {
  
        console.error(
          `申請書 OCR 失敗：${file.name}`,
          error
        );
  
        failedFiles.push(file.name);
      }
    }
  
    // 所有檔案都失敗
    if (allPages.length === 0) {
  
      setImportFeedback(
        "申請書辨識失敗，請確認檔案內容或重新匯入。"
      );
  
      return false;
    }
  
    // ---------- 2. 合併 OCR 頁面 ----------
  
    const combinedDocument = {
      fileName: files.map(file => file.name).join("、"),
      fileType: "application",
      totalPages: allPages.length,
      pages: allPages
    };
  
    // ---------- 3. 呼叫申請書解析器 ----------
  
    let parsed;
  
    try {
  
      parsed = window.ApplicationOCRParser.parseDocument(
        combinedDocument
      );
  
    } catch (error) {
  
      console.error("申請書解析失敗：", error);
  
      setImportFeedback(
        "申請書 OCR 已完成，但解析資料時發生錯誤。"
      );
  
      return false;
    }
  
    // ---------- 4. 儲存解析結果 ----------
  
    documentState.parsedApplicationDocuments.push(parsed);
  
    // ---------- 5. 寫回 HTML 表單 ----------
  
    try {
  
      writeApplicationData(parsed);
  
    } catch (error) {
  
      console.error("申請書資料寫回失敗：", error);
  
      setImportFeedback(
        "申請書解析完成，但寫回表單時發生錯誤。"
      );
  
      return false;
    }
  
    // ---------- 6. 回報辨識結果 ----------
  
    const reviewCount = Array.isArray(parsed.needsReview)
      ? parsed.needsReview.length
      : 0;
  
    let message =
      `申請書辨識完成，共取得 ${allPages.length} 頁。`;
  
    if (reviewCount > 0) {
      message += `另有 ${reviewCount} 個欄位需要人工確認。`;
    }
  
    if (failedFiles.length > 0) {
      message +=
        `以下檔案辨識失敗：${failedFiles.join("、")}。`;
    }
  
    setImportFeedback(message);
  
    return true;
  }

  async function processExpenseFiles() {
    const files = [...documentState.expenseFiles];
  
    // 清除上一次的經費解析結果
    documentState.parsedExpenseDocuments = [];
    documentState.parsedExpenseRows = [];
  
    const allPages = [];
    const pageSourceFiles = [];
    const failedFiles = [];
  
    try {
  
      // 第一階段：逐一對檔案進行 OCR，合併所有頁面
      for (let i = 0; i < files.length; i++) {
  
        const file = files[i];
  
        setImportFeedback(
          `正在辨識第 ${i + 1}/${files.length} 個檔案：${file.name}`
        );
  
        try {
  
          const ocrResult = await window.importsOCR.readDocument(file);
  
          if (!ocrResult || !Array.isArray(ocrResult.pages)) {
            throw new Error("OCR 未回傳有效的頁面資料。");
          }
  
          ocrResult.pages.forEach(page => {
  
            const globalPageNumber = allPages.length + 1;
  
            allPages.push({
              ...page,
              pageNumber: globalPageNumber
            });
  
            pageSourceFiles[globalPageNumber] = file.name;
          });
  
        } catch (error) {
  
          console.error(`檔案辨識失敗：${file.name}`, error);
          failedFiles.push(file.name);
        }
      }
  
      // 所有檔案都沒有成功辨識
      if (allPages.length === 0) {
  
        setImportFeedback(
          "沒有成功辨識的頁面，請確認檔案是否正常。"
        );
  
        return false;
      }
  
      // 第二階段：將所有頁面合併成一份文件，再進行解析
      setImportFeedback("OCR 完成，正在整理經費資料……");
  
      const combinedDocument = {
        fileName: files.map(file => file.name).join("、"),
        fileType: "combined",
        totalPages: allPages.length,
        pages: allPages
      };
  
      const parsed = window.ExpenseOCRParser.parseDocument(
        combinedDocument
      );
  
      // 儲存解析結果
      documentState.parsedExpenseDocuments.push({
        fileName: combinedDocument.fileName,
        result: parsed
      });
  
      // 整理經費項目及來源檔案
      const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  
      documentState.parsedExpenseRows = rows.map(row => ({
        ...row,
        sourceFile: pageSourceFiles[row.sourcePage] || ""
      }));
  
      // 寫回經費表
      window.importExpenseRows(documentState.parsedExpenseRows);
  
      const totalRows = documentState.parsedExpenseRows.length;
  
      let message =
        `辨識完成！共處理 ${allPages.length} 頁，取得 ${totalRows} 筆經費資料。`;
  
      if (failedFiles.length > 0) {
        message += ` 辨識失敗的檔案：${failedFiles.join("、")}`;
      }
  
      setImportFeedback(message);
  
      console.log("合併後的 OCR 頁面：", combinedDocument);
      console.log("整份文件的解析結果：", parsed);
      console.log("所有經費項目：", documentState.parsedExpenseRows);
  
      return true;
  
    } catch (error) {
  
      console.error("經費表處理失敗：", error);
  
      setImportFeedback(
        "經費表解析或資料寫回失敗，請確認檔案內容後重新嘗試。"
      );
  
      return false;
    }
  }
  
  async function startOCR() {
    // 避免重複執行
    if (documentState.isProcessing) return;
  
    const hasApplicationFiles =
      documentState.applicationFiles.length > 0;
  
    const hasExpenseFiles =
      documentState.expenseFiles.length > 0;
  
    // 確認至少有一種檔案
    if (!hasApplicationFiles && !hasExpenseFiles) {
      setImportFeedback("請先選擇要辨識的檔案。");
      return;
    }
  
    documentState.isProcessing = true;
    updateImportControls();
  
    // 分別記錄兩種文件的處理結果
    let applicationSucceeded = false;
    let expenseSucceeded = false;
  
    try {
  
      // ---------- 1. 處理申請書 ----------
  
      if (hasApplicationFiles) {
  
        try {
  
          applicationSucceeded =
            await processApplicationFiles();
  
        } catch (error) {
  
          console.error("申請書處理失敗：", error);
  
          setImportFeedback(
            "申請書處理時發生未預期的錯誤。"
          );
        }
      }
  
      // ---------- 2. 處理經費表 ----------
  
      if (hasExpenseFiles) {
  
        try {
  
          expenseSucceeded =
            await processExpenseFiles();
  
        } catch (error) {
  
          console.error("經費表處理失敗：", error);
  
          setImportFeedback(
            "經費表處理時發生未預期的錯誤。"
          );
        }
      }
  
    } finally {
  
      // ---------- 3. 結束辨識狀態 ----------
  
      documentState.isProcessing = false;
      updateImportControls();
  
      // ---------- 4. 分別清除成功的檔案 ----------
  
      if (applicationSucceeded) {
        clearApplicationFiles();
      }
  
      if (expenseSucceeded) {
        clearExpenseFiles();
      }
  
      // ---------- 5. 確認是否可以關閉 Modal ----------
  
      const hasRemainingFiles =
        documentState.applicationFiles.length > 0 ||
        documentState.expenseFiles.length > 0;
  
      if (!hasRemainingFiles) {
        closeImportModal();
      }
    }
  }

  function clearApplicationFiles() {
    documentState.applicationFiles = [];
  
    const input = $("applicationFilesInput");
    if (input) input.value = "";
  
    renderFileList("application");
  }

  function clearExpenseFiles() {
    documentState.expenseFiles = [];
  
    const input = $("expenseFilesInput");
    if (input) input.value = "";
  
    renderFileList("expense");
  }

  function clearAllFiles() {
    if (documentState.isProcessing) return;
  
    // 清除匯入檔案
    documentState.applicationFiles = [];
    documentState.expenseFiles = [];
  
    // 清除 OCR 解析結果
    documentState.parsedDocuments = [];
    documentState.parsedExpenseRows = [];
  
    // 清除 input 的選取紀錄
    const applicationInput = $("applicationFilesInput");
    const expenseInput = $("expenseFilesInput");
  
    if (applicationInput) applicationInput.value = "";
    if (expenseInput) expenseInput.value = "";
  
    // 更新檔案清單
    renderFileList("application");
    renderFileList("expense");
  
    // 更新辨識按鈕
    updateImportControls();
  
    // 清除所有匯入提示訊息
    const notice = $("importNotice");
  
    if (notice) {
      notice.querySelector(".import-selection-feedback")?.remove();
      notice.querySelector(".import-processing-feedback")?.remove();
    }
  }

  function initialize() {
    $("importFilesBtn")?.addEventListener("click", openImportModal);
    $("closeImportModalBtn")?.addEventListener("click", closeImportModal);
    $("cancelImportModalBtn")?.addEventListener("click", closeImportModal);
    $("clearImportFilesBtn")?.addEventListener("click", clearAllFiles);
    $("startOcrBtn")?.addEventListener("click", startOCR);

    $("applicationFilesInput")?.addEventListener("change", (event) => {
      addSelectedFiles("application", event.target.files || []);
      // 清空 input，讓使用者之後仍可再次選取同一個檔案。
      event.target.value = "";
    });

    $("expenseFilesInput")?.addEventListener("change", (event) => {
      addSelectedFiles("expense", event.target.files || []);
      event.target.value = "";
    });

    $("importModalBackdrop")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeImportModal();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("importModalBackdrop")?.classList.contains("open")) {
        closeImportModal();
      }
    });

    renderFileList("application");
    renderFileList("expense");
    updateImportControls();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
