const PDFDocument = require('pdfkit');
const path = require('path');
const { ArabicPersianReshaper } = require('arabic-persian-reshaper');

// Font paths
const fontRegular = path.join(__dirname, '..', 'fonts', 'Tajawal-Regular.ttf');
const fontBold = path.join(__dirname, '..', 'fonts', 'Tajawal-Bold.ttf');

// Helper to check if a character is Arabic
function isArabicChar(char) {
  const code = char.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0x08A0 && code <= 0x08FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);
}

// Reshapes and reverses Arabic text, keeping numbers and English words left-to-right
function bidiText(text) {
  if (!text) return '';
  
  // Reshape the Arabic letters first
  const reshaped = ArabicPersianReshaper.reshape(text);
  
  // Tokenize the string to separate RTL (Arabic) segments and LTR (Numbers/English) segments
  const words = reshaped.split(/(\s+)/);
  const processedWords = words.map(word => {
    // Check if the word contains Arabic letters
    let hasArabic = false;
    for (let i = 0; i < word.length; i++) {
      if (isArabicChar(word[i])) {
        hasArabic = true;
        break;
      }
    }
    
    if (hasArabic) {
      // Reverse Arabic word so it displays correctly RTL in PDFkit
      return word.split('').reverse().join('');
    } else {
      // Keep numbers/English left-to-right
      return word;
    }
  });

  // Reconnect and reverse the entire word array to keep RTL sentence ordering
  return processedWords.reverse().join('');
}

// Generate PDF Statement (returns a Promise resolving to a base64 string)
function generatePdfBase64(customerName, transactions, periodText, balance) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData.toString('base64'));
      });

      // Register Arabic fonts
      doc.registerFont('Tajawal', fontRegular);
      doc.registerFont('Tajawal-Bold', fontBold);

      // Set Font to Bold for Header
      doc.font('Tajawal-Bold');

      // Title
      doc.fillColor('#2c3e50')
         .fontSize(22)
         .text(bidiText('كشف حساب الصراف الذكي'), { align: 'center' });
      
      doc.moveDown(0.5);
      
      // Subtitle / Period
      doc.font('Tajawal')
         .fillColor('#7f8c8d')
         .fontSize(12)
         .text(bidiText(`الفترة: ${periodText}`), { align: 'center' });

      doc.moveDown(1.5);

      // Customer Details (RTL layout)
      doc.rect(50, 110, 495, 60).fillAndStroke('#f8f9fa', '#e9ecef');
      doc.fillColor('#2c3e50');

      doc.font('Tajawal-Bold').fontSize(12);
      // Label name and phone
      doc.text(bidiText(`اسم الزبون: ${customerName}`), 70, 125, { align: 'right', width: 450 });
      
      // Balance formatting
      const formattedBalance = Number(balance).toLocaleString('ar-EG') + ' د.ع';
      doc.text(bidiText(`الرصيد الحالي: ${formattedBalance}`), 70, 145, { align: 'right', width: 450 });

      doc.moveDown(3);

      // Table Header
      const tableTop = 190;
      doc.font('Tajawal-Bold').fontSize(11).fillColor('#ffffff');
      
      // Table Header Row Background
      doc.rect(50, tableTop, 495, 25).fill('#34495e');

      // Table Headers (RTL columns: Notes | Commission | Amount | Type | Date)
      // Columns configuration:
      // Date: 120 width (50 to 170)
      // Type: 80 width (170 to 250)
      // Amount: 100 width (250 to 350)
      // Commission: 80 width (350 to 430)
      // Notes: 115 width (430 to 545)
      
      doc.text(bidiText('الملاحظات'), 430, tableTop + 6, { width: 105, align: 'center' });
      doc.text(bidiText('العمولة'), 350, tableTop + 6, { width: 80, align: 'center' });
      doc.text(bidiText('المبلغ'), 250, tableTop + 6, { width: 100, align: 'center' });
      doc.text(bidiText('العملية'), 170, tableTop + 6, { width: 80, align: 'center' });
      doc.text(bidiText('التاريخ'), 50, tableTop + 6, { width: 120, align: 'center' });

      // Table Rows
      let y = tableTop + 25;
      doc.font('Tajawal').fontSize(10).fillColor('#2c3e50');

      transactions.forEach((tx, idx) => {
        // Alternating row background
        if (idx % 2 === 0) {
          doc.rect(50, y, 495, 22).fill('#fdfdfd');
        } else {
          doc.rect(50, y, 495, 22).fill('#f7f9fa');
        }
        
        doc.fillColor('#2c3e50');

        const dateStr = new Date(tx.date).toLocaleDateString('en-US');
        const typeStr = tx.type === 'deposit' ? 'إيداع (له)' : 'سحب (عليه)';
        const amountStr = Number(tx.amount).toLocaleString('en-US') + ' د.ع';
        const commStr = Number(tx.commission || 0).toLocaleString('en-US') + ' د.ع';
        const notesStr = tx.notes || '-';

        // Draw Row Cells
        doc.text(bidiText(notesStr), 430, y + 6, { width: 105, align: 'center' });
        doc.text(bidiText(commStr), 350, y + 6, { width: 80, align: 'center' });
        doc.text(bidiText(amountStr), 250, y + 6, { width: 100, align: 'center' });
        doc.text(bidiText(typeStr), 170, y + 6, { width: 80, align: 'center' });
        doc.text(bidiText(dateStr), 50, y + 6, { width: 120, align: 'center' });

        y += 22;

        // Simple page management
        if (y > 750) {
          doc.addPage();
          y = 50;
          // Redraw header if needed
        }
      });

      // Draw footer line
      doc.lineWidth(1).strokeColor('#bdc3c7').moveTo(50, y + 5).lineTo(545, y + 5).stroke();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generatePdfBase64,
  bidiText
};
