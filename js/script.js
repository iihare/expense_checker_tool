(() => {
  const $ = (id) => document.getElementById(id);
  const expenseRows = [];
  let nextId = 1;
  let checkedOnce = false;
  let isStale = false;
  let summaryWidth = 370;
  let toastTimer;

  const moneyFields = ["selfFund", "otherAgency", "expectedFee", "otherAmount", "guidelineGrant", "totalBudget"];
  const expenseFields = [
    ["expenseItem", "item"],
    ["unitPrice", "unitPrice"],
    ["quantity", "quantity"],
    ["budgetAmount", "budget"],
    ["grantAmount", "grant"],
    ["agencyAmount", "agency"],
    ["expenseSelfFund", "self"],
    ["expenseOther", "other"]
  ];
  const fmt = (value) => {
    if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  };
  function showToast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400);
  }
  function markEdited() {
    if (!checkedOnce) {
      $("editStatus").textContent = "尚未檢查";
      return;
    }
    isStale = true;
    $("editStatus").textContent = "資料已修改，請重新檢查";
    $("summaryStatus").textContent = "結果已過期";
  }
  function switchTab(tab) {
    document.querySelectorAll(".tab").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("applicationPage").classList.toggle("hidden", tab !== "application");
    $("expensesPage").classList.toggle("hidden", tab !== "expenses");
  }
  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));

  function openModal() {
    $("expenseModalBackdrop").classList.add("open");
    document.body.style.overflow = "hidden";
    setTimeout(() => $("expenseItem").focus(), 30);
  }
  function closeModal() {
    $("expenseModalBackdrop").classList.remove("open");
    document.body.style.overflow = "";
  }
  $("openAddModalBtn").addEventListener("click", openModal);
  $("openAddModalIcon").addEventListener("click", openModal);
  $("closeModalX").addEventListener("click", closeModal);
  $("cancelModalBtn").addEventListener("click", closeModal);
  $("expenseModalBackdrop").addEventListener("click", (event) => {
    if (event.target === $("expenseModalBackdrop")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("expenseModalBackdrop").classList.contains("open")) closeModal();
  });

  // 金額／數量欄位：即時加入千分位逗號，內部運算前再移除逗號。
  function rawNumericValue(value) {
    return String(value ?? "").replace(/,/g, "").replace(/[^\d.-]/g, "");
  }
  function formatThousands(value) {
    const raw = rawNumericValue(value);
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") return raw;
    const negative = raw.startsWith("-");
    const unsigned = negative ? raw.slice(1) : raw;
    const parts = unsigned.split(".");
    const integerPart = (parts[0] || "").replace(/^0+(?=\d)/, "");
    const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimalPart = parts.length > 1 ? "." + parts.slice(1).join("") : "";
    return (negative ? "-" : "") + grouped + decimalPart;
  }
  
function attachThousandsFormatting(field) {
    let isComposing = false;

    // 進入欄位時移除逗號，方便編輯。
    field.addEventListener("focus", () => {
        field.value = rawNumericValue(field.value);
    });

    // 開始輸入法組字。
    field.addEventListener("compositionstart", () => {
        isComposing = true;
    });

    // 組字期間不格式化，避免干擾輸入。
    field.addEventListener("input", (event) => {
        if (
            isComposing ||
            event.isComposing ||
            event.inputType === "insertCompositionText"
        ) {
            return;
        }

        formatFieldValue(field);
    });

    // 組字結束後，再格式化欄位。
    field.addEventListener("compositionend", () => {
        isComposing = false;

        // 等瀏覽器完成最後一次輸入，再處理格式。
        setTimeout(() => {
            formatFieldValue(field);
        }, 0);
    });

    // 離開欄位時，確保顯示千分位逗號。
    field.addEventListener("blur", () => {
        formatFieldValue(field);
    });
}

function formatFieldValue(field) {
    const start = field.selectionStart ?? field.value.length;

    // 計算游標前有幾個數字。
    const digitsBeforeCursor = rawNumericValue(
        field.value.slice(0, start)
    ).replace(/[^\d]/g, "").length;

    const formatted = formatThousands(field.value);
    field.value = formatted;

    // 依照數字數量還原游標位置。
    let position = 0;
    let counted = 0;

    while (position < formatted.length && counted < digitsBeforeCursor) {
        if (/\d/.test(formatted[position])) {
            counted++;
        }
        position++;
    }

    field.setSelectionRange(position, position);
}

  function numericValue(value) {
    const raw = String(value ?? "").replace(/,/g, "").trim();
    return raw === "" ? "" : Number(raw);
  }

  function renderExpenses() {
    const tbody = $("expenseTableBody");
    tbody.innerHTML = "";
    $("expenseEmpty").style.display = expenseRows.length ? "none" : "block";
    $("expenseCountLabel").textContent = `共 ${expenseRows.length} 筆經費`;
    $("expenseTabCount").textContent = expenseRows.length ? `（${expenseRows.length}）` : "";
    // 更新經費合計
    const totalsElement = $("expenseTotals");

    if (expenseRows.length > 0) {
      const totals = window.calculateTotals(expenseRows);

      $("totalBudget").textContent = fmt(totals.budget);
      $("totalGrant").textContent = fmt(totals.ourGrant);
      $("totalAgency").textContent = fmt(totals.otherGrant);
      $("totalSelf").textContent = fmt(totals.selfFunded);
      $("totalOther").textContent = fmt(totals.other);

      totalsElement.hidden = false;
    } else {
      totalsElement.hidden = true;
    }
    //新增合計欄位結束點
    expenseRows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="item-cell">${escapeHTML(row.item)}<div class="item-sub">經費項目</div></td>
        <td class="numeric">${fmt(row.unitPrice)}</td>
        <td class="numeric">${fmt(row.quantity)}</td>
        <td class="numeric">${fmt(row.budget)}</td>
        <td class="numeric">${fmt(row.grant)}</td>
        <td class="numeric">${fmt(row.agency)}</td>
        <td class="numeric">${fmt(row.self)}</td>
        <td class="numeric">${fmt(row.other)}</td>
        <td class="table-actions"><button class="text-button" data-edit="${row.id}" type="button">編輯</button><button class="text-button danger" data-delete="${row.id}" type="button">刪除</button></td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => {
      const index = expenseRows.findIndex(row => row.id === Number(button.dataset.delete));
      if (index >= 0) {
        expenseRows.splice(index, 1);
        renderExpenses();
        markEdited();
        showToast("已刪除經費資料");
      }
    }));
    tbody.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => {
      const row = expenseRows.find(item => item.id === Number(button.dataset.edit));
      if (!row) return;
      expenseFields.forEach(([fieldId, key]) => $(fieldId).value = row[key] ?? "");
      $("expenseForm").dataset.editingId = String(row.id);
      $("expenseModalTitle").textContent = "編輯經費";
      $("expenseForm").querySelector('[type="submit"]').textContent = "儲存修改";
      openModal();
    }));
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }
  $("expenseForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const item = $("expenseItem").value;
    if (!item) {
      $("expenseItem").focus();
      return;
    }
    const row = { id: Number($("expenseForm").dataset.editingId) || nextId++ };
    expenseFields.forEach(([fieldId, key]) => {
      const value = $(fieldId).value;
      row[key] = key === "item" ? value : numericValue(value);
    });
    const editingId = Number($("expenseForm").dataset.editingId);
    if (editingId) {
      const index = expenseRows.findIndex(item => item.id === editingId);
      if (index >= 0) expenseRows[index] = row;
    } else {
      expenseRows.push(row);
    }
    delete $("expenseForm").dataset.editingId;
    $("expenseForm").reset();
    $("expenseModalTitle").textContent = "新增經費";
    $("expenseForm").querySelector('[type="submit"]').textContent = "加入經費清單";
    closeModal();
    renderExpenses();
    markEdited();
    showToast(editingId ? "已更新經費資料" : "已加入經費清單");
  });

  [...moneyFields.map(id => $(id)), $("unitName"), $("qualification"), $("leader"), $("registeredAddress"), $("mailingAddress")].forEach(field => {
    field.addEventListener("input", markEdited);
    field.addEventListener("change", markEdited);
  });
/*
  $("startCheckBtn").addEventListener("click", () => {
    checkedOnce = true;
    isStale = false;
    $("summaryPane").classList.add("visible");
    $("splitter").classList.add("visible");
    $("editStatus").textContent = "已產生示意摘要";
    $("summaryStatus").textContent = "示意結果";
    $("workspace").style.setProperty("--summary-width", summaryWidth + "px");
    $("summaryPane").style.flexBasis = summaryWidth + "px";
    showToast("已顯示側邊摘要（示意資料，尚未執行檢查）");
  });
*/
  document.getElementById("startCheckBtn").addEventListener("click", startCheck);

  document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => {
    switchTab(button.dataset.goto);
    showToast("已切換至經費表；目前為示意問題，未連結特定資料列");
  }));

  const splitter = $("splitter");
  let dragging = false;
  splitter.addEventListener("pointerdown", (event) => {
    if (!$("summaryPane").classList.contains("visible")) return;
    dragging = true;
    splitter.classList.add("dragging");
    splitter.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  splitter.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const workspaceRect = $("workspace").getBoundingClientRect();
    const desired = workspaceRect.right - event.clientX - 10;
    summaryWidth = Math.max(280, Math.min(Math.round(desired), Math.min(650, workspaceRect.width * .62)));
    $("summaryPane").style.flexBasis = summaryWidth + "px";
  });
  function stopDrag() {
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
  splitter.addEventListener("pointerup", stopDrag);
  splitter.addEventListener("pointercancel", stopDrag);
  splitter.addEventListener("lostpointercapture", stopDrag);

  $("resetDemoBtn").addEventListener("click", () => {
    if (!confirm("要清除目前輸入的資料並重設此原型嗎？")) return;
    document.querySelectorAll("#applicationPage input").forEach(input => input.value = "");
    $("qualification").value = "";
    expenseRows.splice(0, expenseRows.length);
    nextId = 1;
    checkedOnce = false;
    isStale = false;
    $("summaryPane").classList.remove("visible");
    $("splitter").classList.remove("visible");
    $("editStatus").textContent = "尚未檢查";
    $("expenseForm").reset();
    delete $("expenseForm").dataset.editingId;
    $("expenseModalTitle").textContent = "新增經費";
    $("expenseForm").querySelector('[type="submit"]').textContent = "加入經費清單";
    renderExpenses();
    switchTab("application");
    showToast("已重設示意資料");
  });

  // 所有金額欄位與經費表中的數字欄位都使用千分位顯示。
  document.querySelectorAll(
    '#applicationPage input[type="text"][inputmode="numeric"], ' +
    '#expenseForm input[inputmode="numeric"], #expenseForm input[inputmode="decimal"]'
  ).forEach(attachThousandsFormatting);

  renderExpenses();

  
async function startCheck() {
  const button = document.getElementById("startCheckBtn");

  // 防止重複執行
  if (button.disabled) return;

  const originalText = button.textContent;

  // 顯示檢查中狀態
  button.disabled = true;
  button.textContent = "檢查中...";

  
  try {
    // 1. 重置上一次的檢查結果
    appState.checkResults = {
      association: null,
      amount: null,
      expense: null,
      summary: null
    };

    // 2. 收集申請書與經費表資料
    collectAllData();

    // 3. 只有申請類型為「人民團體」才檢查團體資料
    const type = appState.applicationData.qualification;

    if (type === "人民團體") {
      const associationResult = await checkAssociationData();
      console.log("人民團體檢查結果：", associationResult);
    }

    // 4. 檢查申請書金額
    const amountResult = checkAmount();
    console.log("申請書金額檢查結果：", amountResult);

    // 5. 檢查經費表
    const budgetResult = checkBudgetData();
    console.log("經費表檢查結果：", budgetResult);

    // 6. 比對申請書與經費表金額
    const summaryResult = compareSummary();
    console.log("申請書與經費表交叉比對結果：", summaryResult);

  } catch (error) {
    console.error("檢查作業發生錯誤：", error);
  }finally {
    // 無論成功或失敗，都恢復按鈕
    button.disabled = false;
    button.textContent = originalText;
  }
}


  // 提供經費清單的唯讀副本給其他腳本
  window.getExpenseRows = function () {
    return expenseRows.map(row => ({ ...row }));
  };
})();
