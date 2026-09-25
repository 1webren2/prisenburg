// 红狮骑士团 —— 文字冒险游戏主程序
#include <iostream>
#include <limits>
#include <memory>
#include <string>

#include "Character.h"
#include "GameState.h"
#include "Scene.h"

namespace {

// 场景 ID
const std::string kHallOfKnights = "Hall of Knights";
const std::string kTrainingGround = "Training ground";

// 主要角色名
const std::string kSibylla = "Sibylla";

// 好感度超过该值时解锁隐藏选项
const int kAffectionThreshold = 60;

// 构建全部角色、场景与选择
void buildWorld(GameState& state) {
    state.addCharacter(std::make_shared<Character>(kSibylla, 24, "Vice-Captain of the Red Lion Knights"));

    // ---------------- 场景一：骑士大厅 ----------------
    auto hall = std::make_shared<Scene>(kHallOfKnights);
    hall->addDialogue(kSibylla, "Welcome to the Red Lion Knights!");
    hall->addDialogue("User", "I would like to ask, what is the spiritual creed of the Red Lion Knights?");
    hall->addDialogue(kSibylla, "Wisdom, Power, Courage!");
    hall->addDialogue(kSibylla, "Anywhere you'd like to go now? (Gazing at you with anticipation)");

    // 选项 1：去训练场（无条件，必选）
    hall->addChoice(Choice("Go to the Sword Training Ground", kTrainingGround));

    // 选项 2：称赞团长 —— 好感度 +10，留在本场景
    Choice praise("Praise Sibylla", kHallOfKnights);
    praise.setEffect([](GameState& s) {
        if (auto sibylla = s.getCharacter(kSibylla)) {
            sibylla->changeAffection(10);
        }
    });
    hall->addChoice(praise);

    state.addScene(hall);

    // ---------------- 场景二：训练场 ----------------
    auto ground = std::make_shared<Scene>(kTrainingGround);
    ground->addDialogue(kSibylla, "Welcome to the Training ground.");
    ground->addDialogue(kSibylla, "Want to practice your sword skills?");
    ground->addDialogue("User", "That's a nice suggestion, but I'd rather take a walk around.");
    ground->addDialogue(kSibylla, "Then please feel free to explore on your own.");

    // 选项 1：回大厅
    ground->addChoice(Choice("Return to the Knights' Hall", kHallOfKnights));

    // 选项 2：自己练剑 —— 力量 +20
    Choice practice("Practice swordsmanship", kTrainingGround);
    practice.setEffect([](GameState& s) {
        s.addVariable("User_power", 20);
    });
    ground->addChoice(practice);

    // 选项 3：邀请 Sibylla 一起练剑 —— 好感度 > 60 才解锁
    Choice practiceWithSibylla("Find Sibylla and practice swordplay", kTrainingGround);
    practiceWithSibylla.setCondition([](const GameState& s) {
        auto sibylla = s.getCharacter(kSibylla);
        return sibylla != nullptr && sibylla->affection() > kAffectionThreshold;
    });
    practiceWithSibylla.setEffect([](GameState& s) {
        if (auto sibylla = s.getCharacter(kSibylla)) {
            sibylla->changeAffection(20);
        }
        s.addVariable("User_power", 25);
    });
    ground->addChoice(practiceWithSibylla);

    state.addScene(ground);
}

// 显示当前的数值状态
void printStatus(const GameState& state) {
    std::cout << "--------- Status ---------" << std::endl;
    if (auto sibylla = state.getCharacter(kSibylla)) {
        sibylla->output();
    }
    std::cout << "User_power: " << state.getVariable("User_power") << std::endl;
    std::cout << "--------------------------" << std::endl;
}

// 读取玩家输入，返回 0 ~ maxOption（0 表示退出游戏）
int readChoice(int maxOption) {
    int value = 0;
    while (true) {
        std::cout << "> ";
        if (std::cin >> value) {
            if (value >= 0 && value <= maxOption) {
                return value;
            }
            std::cout << "Invalid input, please enter a number between 0 and " << maxOption << "." << std::endl;
            continue;
        }
        if (std::cin.eof()) {  // 输入流已结束（例如 Ctrl+Z），直接退出
            std::cout << std::endl;
            return 0;
        }
        std::cin.clear();
        std::cin.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
        std::cout << "Invalid input, please enter a number between 0 and " << maxOption << "." << std::endl;
    }
}

}  // namespace

int main() {
    GameState state;
    buildWorld(state);
    state.setCurrentScene(kHallOfKnights);

    std::string printedSceneId;  // 台词只在该场景首次进入时打印，避免重复刷屏

    while (true) {
        const std::string currentId = state.currentSceneId();
        std::shared_ptr<Scene> scene = state.getScene(currentId);
        if (scene == nullptr) {
            std::cout << "Scene \"" << currentId << "\" not found. Game Over!" << std::endl;
            break;
        }

        std::cout << "\n===== " << scene->id() << " =====" << std::endl;
        if (printedSceneId != scene->id()) {
            for (const auto& line : scene->dialogues()) {
                std::cout << line.name() << " : " << line.dialogue() << std::endl;
            }
            printedSceneId = scene->id();
        }
        std::cout << std::endl;
        printStatus(state);  // 每回合都显示，方便看到好感度/力量的变化

        const std::vector<Choice>& choices = scene->choices();
        std::cout << "\nEnter your choice (0 means the game is over):" << std::endl;
        for (std::size_t i = 0; i < choices.size(); ++i) {
            std::cout << (i + 1) << "." << choices[i].text();
            if (!choices[i].isAvailable(state)) {
                std::cout << "   (Locked: affection too low)";
            }
            std::cout << std::endl;
        }

        const int choose = readChoice(static_cast<int>(choices.size()));
        if (choose == 0) {
            std::cout << "Game Over!" << std::endl;
            break;
        }

        const Choice& choice = choices[static_cast<std::size_t>(choose) - 1];
        if (!choice.isAvailable(state)) {
            std::cout << "You can't choose this yet (affection too low)." << std::endl;
            continue;
        }

        choice.applyEffect(state);
        state.setCurrentScene(choice.nextSceneId());

        if (choice.nextSceneId() == currentId) {
            std::cout << "Selection successful." << std::endl;
        }
    }

    return 0;
}
