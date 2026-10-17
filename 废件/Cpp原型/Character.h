#ifndef CHARACTER_H
#define CHARACTER_H

#include <string>

// 角色：姓名 / 年龄 / 身份 / 好感度
class Character {
public:
    Character(const std::string& name, int age, const std::string& identity);

    const std::string& name() const { return name_; }
    int age() const { return age_; }
    const std::string& identity() const { return identity_; }
    int affection() const { return affection_; }

    // 好感度增减，结果自动限制在 [0, 100]
    void changeAffection(int delta);
    void setAffection(int value);

    void output() const;

private:
    std::string name_;      // 姓名
    int age_;               // 年龄
    std::string identity_;  // 身份
    int affection_ = 0;     // 好感度
};

#endif // CHARACTER_H
