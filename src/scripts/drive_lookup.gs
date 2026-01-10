/**
 * Google Apps Script for Chatbot Drive Image Lookup (Final Stable)
 */

function doPost(e) {
  console.log("📥 Received POST request");
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ success: false, error: "Empty request body" });
    }

    const data = JSON.parse(e.postData.contents);
    const searchTerm = (data.folder || data.filename || "").trim();
    const parentId = (data.parentId || "").trim();
    const searchMode = data.searchMode || "folder";

    console.log("🔍 Search Params:", { searchTerm, searchMode, parentId });

    if (!searchTerm) {
      return createResponse({ success: false, error: "Missing search term" });
    }

    let foundImages = [];
    let foldersToProcess = [];

    // Search Mode: FILE
    if (searchMode === "file") {
      const escapedTerm = searchTerm.replace(/'/g, "\\'");
      let query =
        "name contains '" +
        escapedTerm +
        "' and mimeType contains 'image/' and trashed = false";
      if (parentId) query += " and '" + parentId + "' in parents";

      const files = DriveApp.searchFiles(query);
      while (files.hasNext()) {
        const file = files.next();
        foundImages.push({
          id: file.getId(),
          name: file.getName(),
          url: "https://drive.google.com/uc?export=download&id=" + file.getId(),
        });
      }
    }
    // Search Mode: FOLDER (Standard)
    else {
      // Step 1: Find the target folder (Handling slashes/special chars)
      let folderIterator;
      if (parentId) {
        try {
          folderIterator = DriveApp.getFolderById(parentId).getFolders();
        } catch (e) {
          console.error("❌ Parent ID Access Error:", e.message);
          folderIterator = DriveApp.getFolders();
        }
      } else {
        folderIterator = DriveApp.getFolders();
      }

      const termLower = searchTerm.toLowerCase();
      while (folderIterator.hasNext()) {
        const f = folderIterator.next();
        if (
          f.getName().trim().toLowerCase() === termLower ||
          f.getName().toLowerCase().indexOf(termLower) !== -1
        ) {
          console.log("📁 Folder Match:", f.getName());
          foldersToProcess.push(f);
          break; // Stop at first match for performance
        }
      }

      // Step 2: Get images from the folder
      if (foldersToProcess.length > 0) {
        const target = foldersToProcess[0];
        const files = target.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          if (file.getMimeType().indexOf("image/") !== -1) {
            foundImages.push({
              id: file.getId(),
              name: file.getName(),
              url:
                "https://drive.google.com/uc?export=download&id=" +
                file.getId(),
            });
          }
        }
      }
    }

    console.log("✅ Results Found:", foundImages.length);
    return createResponse({
      success: true,
      found: foundImages.length > 0,
      images: foundImages,
      count: foundImages.length,
    });
  } catch (error) {
    console.error("❌ Fatal Script Error:", error.toString());
    return createResponse({ success: false, error: error.toString() });
  }
}

function manualTest() {
  const testFolder = "Pond Liners / പടുത";
  const testParent = "1AUU2kGBqlPnXsnEiou_ySboR7a2_w09y";

  console.log("🧪 Manual Test for:", testFolder);
  const e = {
    postData: {
      contents: JSON.stringify({
        folder: testFolder,
        parentId: testParent,
        searchMode: "folder",
      }),
    },
  };
  const response = doPost(e);
  console.log("📦 Result:", response.getContent());
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet() {
  return createResponse({ status: "Drive Lookup API Active" });
}
