-- AlterTable
ALTER TABLE `Broadcast` ADD COLUMN `mediaId` VARCHAR(191) NULL,
    ADD COLUMN `mediaType` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Flow` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `nodes` LONGTEXT NOT NULL,
    `edges` LONGTEXT NOT NULL,
    `triggerKeyword` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `workingHours` LONGTEXT NULL,
    `sessionTimeout` INTEGER NOT NULL DEFAULT 3600,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,

    INDEX `Flow_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FlowSession` (
    `id` VARCHAR(191) NOT NULL,
    `currentNodeId` VARCHAR(191) NULL,
    `variables` LONGTEXT NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `lastInteraction` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `flowId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,

    INDEX `FlowSession_flowId_idx`(`flowId`),
    INDEX `FlowSession_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `FlowSession_contactId_organizationId_key`(`contactId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactGroup` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContactGroup_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `ContactGroup_name_organizationId_key`(`name`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ContactToGroup` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ContactToGroup_AB_unique`(`A`, `B`),
    INDEX `_ContactToGroup_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Flow` ADD CONSTRAINT `Flow_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FlowSession` ADD CONSTRAINT `FlowSession_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FlowSession` ADD CONSTRAINT `FlowSession_flowId_fkey` FOREIGN KEY (`flowId`) REFERENCES `Flow`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FlowSession` ADD CONSTRAINT `FlowSession_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactGroup` ADD CONSTRAINT `ContactGroup_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ContactToGroup` ADD CONSTRAINT `_ContactToGroup_A_fkey` FOREIGN KEY (`A`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ContactToGroup` ADD CONSTRAINT `_ContactToGroup_B_fkey` FOREIGN KEY (`B`) REFERENCES `ContactGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
